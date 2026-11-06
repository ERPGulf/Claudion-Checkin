#!/usr/bin/env python3
"""Disposable localhost attendance backend; never a live Frappe verification."""

import argparse
import base64
import copy
import datetime as dt
import json
import os
from pathlib import Path
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


EMPLOYEES = {
    "android": "QA-ANDROID-001",
    "ios": "QA-IOS-001",
    "auto": "QA-AUTO-001",
}
PREFIX = "/api/method/employee_app."
SENSITIVE = {"authorization", "api_secret", "access_token", "refresh_token", "fcm_token", "token", "password", "otp"}
DEFAULT_CONFIG = {
    "network": "online",
    "geoTagging": True,
    "geotagging": 2,
    "offlineEnabled": True,
    "restrictLocation": 1,
    "unrestrictedCheckoutLocation": 0,
    "photo": 0,
    "geometry": {"latitude": 25.2854, "longitude": 51.5310, "radius": 100},
    "nextAttendance": None,
    # Slows only policy reads, so outbox delivery can be observed ahead of them.
    "policyDelaySeconds": 0,
}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")


def server_time():
    # Deliberately UTC wall clock: the app learns the clock instead of assuming a zone.
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def sanitize(value):
    if isinstance(value, dict):
        return {key: "[redacted]" if key.lower() in SENSITIVE else sanitize(item)
                for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    return value


class QaState:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.configs = {employee: copy.deepcopy(DEFAULT_CONFIG) for employee in EMPLOYEES.values()}
        self.records = []
        self.requests = []
        self.controls = []
        self.started_at = now_iso()
        saved_path = self.directory / "state.json"
        if saved_path.exists():
            saved = json.loads(saved_path.read_text())
            self.records = saved.get("records", [])
            self.requests = saved.get("requests", [])
            self.controls = saved.get("controls", [])
            for employee, config in saved.get("configs", {}).items():
                if employee in self.configs:
                    self.configs[employee].update(config)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy({
                "kind": "LOCAL_MOCK_BACKEND_ONLY",
                "startedAt": self.started_at,
                "configs": self.configs,
                "records": self.records,
                "requests": self.requests,
                "controls": self.controls,
            })

    def persist(self):
        # The lock also keeps request logging and accepted records atomic in evidence.
        with self.lock:
            temporary = self.directory / "state.json.tmp"
            temporary.write_text(json.dumps(self.snapshot(), indent=2) + "\n")
            os.replace(temporary, self.directory / "state.json")

    def audit(self, event):
        with self.lock:
            event = sanitize(event)
            event["sequence"] = len(self.requests) + 1
            event["receivedAt"] = now_iso()
            self.requests.append(event)
            with (self.directory / "requests.jsonl").open("a") as stream:
                stream.write(json.dumps(event) + "\n")
            self.persist()
            return event

    def attendance(self, employee, payload, offline, received_at):
        with self.lock:
            if employee not in self.configs:
                raise ValueError("Only disposable QA employees are accepted")
            timestamp = payload.get("timestamp")
            action = payload.get("log_type")
            if not isinstance(timestamp, str) or not timestamp.strip() or action not in ("IN", "OUT"):
                raise ValueError("timestamp and IN/OUT log_type are required")
            # Validate without normalizing the original wall-clock string.
            dt.datetime.fromisoformat(timestamp)
            existing = next((row for row in self.records if row["employee"] == employee
                             and row["time"] == timestamp and row["log_type"] == action), None)
            if existing:
                return existing, True
            row = {
                "name": f"QA-CHECKIN-{len(self.records) + 1:05d}",
                "employee": employee,
                "employee_name": f"Disposable {employee}",
                "time": timestamp,
                "timestamp": timestamp,
                "log_type": action,
                "custom_in": 1 if action == "IN" else 0,
                "device_id": payload.get("device_id", "MobileAPP"),
                "auto": payload.get("auto") if not offline else None,
                "location": payload.get("location"),
                "latitude": payload.get("latitude"),
                "longitude": payload.get("longitude"),
                "receivedAt": received_at,
                "storedAt": now_iso(),
                "endpoint": "offline" if offline else "online",
            }
            self.records.append(row)
            with (self.directory / "records.jsonl").open("a") as stream:
                stream.write(json.dumps(row) + "\n")
            self.persist()
            return row, False


def fixture(platform, port):
    if platform not in EMPLOYEES:
        raise ValueError("platform must be android, ios, or auto")
    employee = EMPLOYEES[platform]
    tenant = f"http://{'10.0.2.2' if platform == 'android' else 'localhost'}:{port}"
    storage = {
        "baseUrl": tenant,
        "api_key": employee,
        "app_key": "cWEtYXBw==",
        "employee_code": employee,
        "employee_id": employee,
        "username": f"qa-{platform}@localhost.invalid",
        "full_name": f"Disposable {platform.title()} Employee",
        "auth_method": "qr",
        "photo": "0",
        "restrict_location": "1",
        "unrestricted_checkout_location": "0",
    }
    qr = (f"Company:{tenant} Employee_Code:{employee} Full_Name:{storage['full_name']} "
          f"User_id:{storage['username']} API:{storage['api_key']} App_key:{storage['app_key']} "
          "Photo:0 Restrict Location:1 Unrestricted Checkout Location:0")
    return {
        "kind": "LOCAL_SYNTHETIC_FIXTURE_ONLY",
        "platform": platform,
        "employeeId": employee,
        "storage": storage,
        "reduxUser": {"baseUrl": tenant, "username": storage["username"],
                      "fullname": storage["full_name"], "userDetails": {"employeeCode": employee}},
        "login": {"api_key": storage["api_key"], "app_key": storage["app_key"],
                  "api_secret": "QaPass123!"},
        "qrBase64": base64.b64encode(qr.encode()).decode(),
        "office": {"latitude": 25.2854, "longitude": 51.5310, "radius": 100},
        "outside": {"latitude": 25.29, "longitude": 51.54},
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *_args):
        # BaseHTTPRequestHandler includes full query paths; evidence is sanitized separately.
        pass

    @property
    def state(self):
        return self.server.qa_state

    def reply(self, value, status=200):
        data = json.dumps(value, ensure_ascii=False).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def disconnect(self):
        self.close_connection = True
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.connection.close()

    def parse(self):
        url = urlsplit(self.path)
        params = {key: values[-1] for key, values in parse_qs(url.query).items()}
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1024 * 1024:
            raise ValueError("Body too large")
        if length:
            body = self.rfile.read(length).decode()
            if "application/json" in self.headers.get("Content-Type", ""):
                parsed = json.loads(body)
                if not isinstance(parsed, dict):
                    raise ValueError("Expected an object body")
                params.update(parsed)
            elif "application/x-www-form-urlencoded" in self.headers.get("Content-Type", ""):
                params.update({key: values[-1] for key, values in parse_qs(body, keep_blank_values=True).items()})
            else:
                # FCM/form uploads are accepted without retaining token-bearing bodies.
                params["bodyOmitted"] = True
        return url.path, params

    def employee(self):
        authorization = self.headers.get("Authorization", "")
        prefix = "Bearer qa-access."
        candidate = authorization[len(prefix):] if authorization.startswith(prefix) else None
        return candidate if candidate in self.state.configs else None

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def do_PUT(self):
        self.handle_request()

    def handle_request(self):
        try:
            path, params = self.parse()
            if path == "/__qa/state" and self.command == "GET":
                self.reply(self.state.snapshot())
                return
            if path == "/__qa/fixture" and self.command == "GET":
                self.reply(fixture(params.get("platform", "auto"), self.server.server_port))
                return
            if path == "/__qa/control" and self.command == "POST":
                self.control(params)
                return
            employee = self.employee()
            request = self.state.audit({"method": self.command, "path": path,
                                        "employee": employee, "params": params})
            if path == PREFIX + "gauth.generate_token_secure":
                self.login(params)
                return
            if path == PREFIX + "gauth.create_refresh_token":
                token = params.get("refresh_token", "")
                candidate = token.removeprefix("qa-refresh.")
                if token.startswith("qa-refresh.") and candidate in self.state.configs:
                    self.tokens(candidate)
                else:
                    self.reply({"message": "Invalid disposable QA refresh credentials"}, 401)
                return
            if not employee:
                self.reply({"message": "Disposable QA authorization required"}, 401)
                return
            with self.state.lock:
                config = copy.deepcopy(self.state.configs[employee])
            if config["network"] == "drop":
                self.disconnect()
                return
            if config["network"] == "503":
                self.reply({"message": "Local QA simulated service unavailable"}, 503)
                return
            requested_employee = params.get("employee_id") or params.get("employee_field_value") or params.get("employee_code") or params.get("employee")
            if requested_employee and requested_employee != employee:
                self.reply({"message": "Disposable QA employee scope mismatch"}, 403)
                return
            if not path.startswith(PREFIX):
                self.reply({"message": "Unknown local QA endpoint"}, 404)
                return
            method = path[len(PREFIX):]
            if method in ("gauth.employee_checkin_setting", "attendance_api.get_employee_data"):
                time.sleep(float(config.get("policyDelaySeconds", 0)))
            if method == "gauth.employee_checkin_setting":
                self.reply({"message": self.features(config)})
            elif method == "attendance_api.get_employee_data":
                self.reply({"message": self.employee_data(employee, config)})
            elif method == "attendance_api.get_server_time":
                self.reply({"message": {"server_time": server_time()}})
            elif method == "attendance_api.get_attendance_details":
                with self.state.lock:
                    records = [row for row in self.state.records if row["employee"] == employee]
                records.sort(key=lambda row: (row["time"], row["name"]), reverse=True)
                start, length = int(params.get("limit_start", 0)), int(params.get("limit_page_length", 20))
                self.reply({"message": records[start:start + min(length, 100)]})
            elif method in ("attendance_api.add_log_based_on_employee_field", "attendance_api.add_offline_employee_checkins"):
                if self.command != "POST":
                    self.reply({"message": "POST required"}, 405)
                    return
                self.punch(employee, params, method.endswith("add_offline_employee_checkins"), request)
            elif method in ("attendance_api.get_total_hours", "attendance_api.get_monthly_hours"):
                self.reply({"message": "00:00"})
            elif method == "attendance_api.get_today_breaks":
                self.reply({"message": {"total_break_minutes": 0, "breaks": []}})
            elif method == "attendance_api.employee":
                # Mirrors a status field only. It never inserts attendance records.
                self.reply({"message": self.employee_data(employee, config)})
            elif "fcm" in method or "firebase" in method:
                self.reply({"message": {"topics": [], "token_updated": True}})
            elif method.startswith(("attendance_api.get_", "employee_list.list_")):
                self.reply({"message": []})
            elif method == "attendance_api.mark_notification_as_read":
                self.reply({"message": True})
            else:
                self.reply({"message": "Unsupported operation in disposable local QA backend"}, 404)
        except (ValueError, TypeError, KeyError) as error:
            self.reply({"message": str(error)}, 400)

    def tokens(self, employee):
        self.reply({"data": {"access_token": "qa-access." + employee,
                             "refresh_token": "qa-refresh." + employee}})

    def login(self, params):
        for platform, employee in EMPLOYEES.items():
            if (params.get("api_key") == employee and
                    params.get("app_key") == "cWEtYXBw==" and
                    params.get("api_secret") == "QaPass123!"):
                self.tokens(employee)
                return
        self.reply({"message": "Invalid disposable QA credentials"}, 401)

    def control(self, params):
        employees = [params.get("employee")] if params.get("employee") else list(EMPLOYEES.values())
        changes = {key: value for key, value in params.items() if key != "employee"}
        if any(employee not in self.state.configs for employee in employees):
            raise ValueError("Unknown disposable QA employee")
        if set(changes) - set(DEFAULT_CONFIG):
            raise ValueError("Unknown QA control; attendance records cannot be injected or reset")
        if "network" in changes and changes["network"] not in ("online", "drop", "503"):
            raise ValueError("network must be online, drop, or 503")
        if "geotagging" in changes and changes["geotagging"] not in (0, 1, 2):
            raise ValueError("geotagging must be 0, 1, or 2")
        if "nextAttendance" in changes and changes["nextAttendance"] is not None:
            attempt = changes["nextAttendance"]
            if not isinstance(attempt, dict) or attempt.get("behavior") not in ("accept_disconnect", "accept_timeout", "ambiguous", "reject"):
                raise ValueError("Unknown nextAttendance behavior")
            if not 0 <= float(attempt.get("delaySeconds", 20)) <= 120:
                raise ValueError("delaySeconds must be 0..120")
        if "policyDelaySeconds" in changes and not 0 <= float(changes["policyDelaySeconds"]) <= 120:
            raise ValueError("policyDelaySeconds must be 0..120")
        if "geometry" in changes:
            geometry = changes["geometry"]
            if set(geometry) != {"latitude", "longitude", "radius"} or not (
                    -90 <= float(geometry["latitude"]) <= 90 and
                    -180 <= float(geometry["longitude"]) <= 180 and float(geometry["radius"]) > 0):
                raise ValueError("A complete valid geometry is required")
        with self.state.lock:
            for employee in employees:
                self.state.configs[employee].update(copy.deepcopy(changes))
            self.state.controls.append({"at": now_iso(), "employees": employees, "changes": changes})
            self.state.persist()
        self.reply({"message": "Local QA controls updated", "employees": employees, "changes": changes})

    def punch(self, employee, params, offline, request):
        if offline:
            logs = params.get("logs")
            if isinstance(logs, str):
                logs = json.loads(logs)
            if not isinstance(logs, list) or len(logs) != 1:
                raise ValueError("Local QA enforces the app's one-record offline contract")
            payload = logs[0]
            if payload.get("employee") != employee:
                self.reply({"message": "Disposable QA employee scope mismatch"}, 403)
                return
        else:
            payload = params
        with self.state.lock:
            behavior = self.state.configs[employee].get("nextAttendance")
            self.state.configs[employee]["nextAttendance"] = None
            self.state.persist()
        kind = behavior.get("behavior") if behavior else None
        if kind == "reject":
            self.reply({"message": "Employee is inactive (local QA test refusal)"}, 422)
            return
        record, duplicate = self.state.attendance(employee, payload, offline, request["receivedAt"])
        if kind == "accept_disconnect":
            self.disconnect()
            return
        if kind == "accept_timeout":
            time.sleep(float(behavior.get("delaySeconds", 20)))
        if kind == "ambiguous":
            self.reply({"message": {"status": "success", "message": "Local QA ambiguous accepted response"}})
        elif offline and duplicate:
            self.reply({"message": {"status": "error", "inserted": [],
                                    "failed": [{"error": f"This Employee Checkin already exists: {record['name']}"}]}})
        elif offline:
            self.reply({"message": {"status": "success", "inserted": [record["name"]],
                                    "failed": [], "inserted_count": 1, "failed_count": 0}})
        else:
            self.reply({"message": {"name": record["name"]}})

    @staticmethod
    def features(config):
        return {
            "loan_application": False, "leave_request": False, "employee_records": False,
            "complaints": False, "expense_claim": False, "employee_resignation": False,
            "attendance_action": {
                "offline_attendance": config["offlineEnabled"], "offline_attendance_version": "1",
                "photo_upload": False, "restrict_location": True,
                "unrestricted_checkout_location": False, "employee_shift": False,
                "employee_checkin_break": False, "attendance_request": False,
                "attendance_history": True, "geo_tagging": config["geoTagging"],
            },
        }

    def employee_data(self, employee, config):
        geometry = config["geometry"]
        with self.state.lock:
            records = [row for row in self.state.records if row["employee"] == employee]
        latest = max(records, key=lambda row: (row["time"], row["name"]), default={})
        return {
            "name": employee, "employee": employee, "employee_id": employee,
            "employee_name": f"Disposable {employee}", "company": "LOCAL QA ONLY",
            "department": "QA", "designation": "Disposable simulator employee",
            "status": "Active", "custom_in": latest.get("custom_in", 0),
            "geotagging": config["geotagging"], "restrict_location": config["restrictLocation"],
            "unrestricted_checkout_location": config["unrestrictedCheckoutLocation"], "photo": config["photo"],
            "employee_locations": [{
                "location": "Disposable QA Doha Office", "latitude": geometry["latitude"],
                "longitude": geometry["longitude"], "reporting_radius": geometry["radius"],
                "reporting_location": json.dumps({"type": "FeatureCollection", "features": [{
                    "type": "Feature", "properties": {}, "geometry": {
                        "type": "Point", "coordinates": [geometry["longitude"], geometry["latitude"]]},
                }]}),
            }],
        }


def create_server(host, port, directory):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.qa_state = QaState(directory)
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", choices=("127.0.0.1", "0.0.0.0"), default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", required=True, help="New disposable directory under /tmp")
    args = parser.parse_args()
    data_dir = Path(args.data_dir).resolve()
    if not data_dir.is_relative_to(Path("/tmp").resolve()):
        parser.error("--data-dir must be under /tmp; production data is unsupported")
    server = create_server(args.host, args.port, data_dir)
    server.qa_state.persist()
    print(f"LOCAL MOCK ONLY listening on {args.host}:{server.server_port}; sanitized evidence in {data_dir}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
