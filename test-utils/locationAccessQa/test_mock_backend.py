"""Contract tests for the disposable server, not native app integration tests."""

import json
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from mock_backend import EMPLOYEES, PREFIX, create_server


class MockBackendTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="claudion-qa-backend-contract-")
        self.server = create_server("127.0.0.1", 0, self.directory.name)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.employee = EMPLOYEES["auto"]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.directory.cleanup()

    def request(self, path, data=None, form=False, employee=None, authenticated=True):
        headers = {}
        if authenticated:
            headers["Authorization"] = "Bearer qa-access." + (employee or self.employee)
        if data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
            encoded = urlencode(data).encode() if form else json.dumps(data).encode()
        else:
            encoded = None
        request = Request(self.origin + path, data=encoded, headers=headers)
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            with error:
                return error.code, json.load(error)

    def punch(self, action="OUT", timestamp="2026-10-30 08:12:01.123456", **extra):
        return self.request(PREFIX + "attendance_api.add_log_based_on_employee_field", {
            "employee_field_value": self.employee, "log_type": action,
            "timestamp": timestamp, "auto": True, "device_id": "MobileAPP", **extra,
        })

    def test_fixture_real_login_envelope_and_sanitized_evidence(self):
        status, setup = self.request("/__qa/fixture?platform=ios", authenticated=False)
        self.assertEqual(status, 200)
        self.assertEqual(setup["storage"]["baseUrl"], f"http://localhost:{self.server.server_port}")
        self.assertEqual(setup["reduxUser"]["userDetails"]["employeeCode"], EMPLOYEES["ios"])
        status, body = self.request(PREFIX + "gauth.generate_token_secure", setup["login"], form=True, authenticated=False)
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["access_token"], "qa-access." + EMPLOYEES["ios"])
        status, _ = self.request(PREFIX + "gauth.create_refresh_token", {
            "refresh_token": body["data"]["refresh_token"],
        }, form=True, authenticated=False)
        self.assertEqual(status, 200)
        snapshot = self.server.qa_state.snapshot()
        text = json.dumps(snapshot)
        self.assertNotIn(setup["login"]["api_secret"], text)
        self.assertNotIn(body["data"]["access_token"], text)
        self.assertNotIn(body["data"]["refresh_token"], text)
        self.assertEqual(snapshot["requests"][0]["params"]["api_secret"], "[redacted]")
        self.assertEqual(snapshot["records"], [])

    def test_online_and_offline_preserve_original_time_and_deduplicate(self):
        original = "2026-10-30 01:02:03.456789"
        status, online = self.punch(timestamp=original)
        self.assertEqual(status, 200)
        payload = {"logs": [{"employee": self.employee, "timestamp": original,
                             "log_type": "OUT", "device_id": "MobileAPP", "over_time": 0}]}
        status, duplicate = self.request(PREFIX + "attendance_api.add_offline_employee_checkins", payload)
        self.assertEqual(status, 200)
        self.assertIn("already exists", duplicate["message"]["failed"][0]["error"])
        self.assertEqual(duplicate["message"]["inserted"], [])
        status, history = self.request(PREFIX + "attendance_api.get_attendance_details?employee_id=" + self.employee)
        self.assertEqual(status, 200)
        self.assertEqual(len(history["message"]), 1)
        record = history["message"][0]
        self.assertEqual(record["name"], online["message"]["name"])
        self.assertEqual(record["time"], original)
        self.assertEqual(record["timestamp"], original)
        self.assertTrue(record["storedAt"].endswith("+00:00"))
        payload["logs"][0].update(timestamp="2026-10-30 01:03:03", log_type="IN")
        status, uploaded = self.request(PREFIX + "attendance_api.add_offline_employee_checkins", payload)
        self.assertEqual(status, 200)
        self.assertEqual(len(uploaded["message"]["inserted"]), 1)
        self.assertEqual(self.server.qa_state.records[-1]["time"], "2026-10-30 01:03:03")

    def test_employee_scope_rejects_cross_employee_punch_and_history(self):
        status, _ = self.punch(employee_field_value=EMPLOYEES["ios"])
        self.assertEqual(status, 403)
        status, _ = self.request(PREFIX + "attendance_api.get_attendance_details?employee_id=" + EMPLOYEES["ios"])
        self.assertEqual(status, 403)
        status, _ = self.request(PREFIX + "attendance_api.add_offline_employee_checkins", {
            "logs": [{"employee": EMPLOYEES["ios"], "timestamp": "2026-10-30 01:02:03", "log_type": "IN"}],
        })
        self.assertEqual(status, 403)
        self.assertEqual(self.server.qa_state.records, [])

    def test_policy_controls_never_insert_records_and_provenance_survives_restart(self):
        status, _ = self.request("/__qa/control", {"employee": self.employee, "geotagging": 1, "geoTagging": False})
        self.assertEqual(status, 200)
        status, employee = self.request(PREFIX + "attendance_api.get_employee_data?employee_id=" + self.employee)
        self.assertEqual(status, 200)
        self.assertEqual(employee["message"]["geotagging"], 1)
        self.assertEqual(employee["message"]["employee_locations"][0]["reporting_radius"], 100)
        status, features = self.request(PREFIX + "gauth.employee_checkin_setting")
        self.assertEqual(status, 200)
        self.assertIs(features["message"]["attendance_action"]["geo_tagging"], False)
        self.assertEqual(self.server.qa_state.records, [])
        status, _ = self.request("/__qa/control", {"records": [{"log_type": "IN"}]})
        self.assertEqual(status, 400)
        self.punch()
        restored = create_server("127.0.0.1", 0, self.directory.name)
        try:
            self.assertEqual(restored.qa_state.records, self.server.qa_state.records)
            self.assertEqual(restored.qa_state.configs[self.employee]["geotagging"], 1)
            self.assertTrue(restored.qa_state.requests)
        finally:
            restored.server_close()

    def test_one_record_offline_contract_and_invalid_timestamps_do_not_insert(self):
        status, _ = self.request(PREFIX + "attendance_api.add_offline_employee_checkins", {"logs": []})
        self.assertEqual(status, 400)
        status, _ = self.punch(timestamp="not a timestamp")
        self.assertEqual(status, 400)
        self.assertEqual(self.server.qa_state.records, [])

    def test_ambiguous_accept_is_persisted_once_and_fault_is_consumed(self):
        status, _ = self.request("/__qa/control", {
            "employee": self.employee, "nextAttendance": {"behavior": "ambiguous"},
        })
        self.assertEqual(status, 200)
        status, response = self.punch()
        self.assertEqual(status, 200)
        self.assertNotIn("name", response["message"])
        self.assertEqual(len(self.server.qa_state.records), 1)
        self.assertIsNone(self.server.qa_state.configs[self.employee]["nextAttendance"])
        status, repeated = self.punch()
        self.assertEqual(status, 200)
        self.assertEqual(repeated["message"]["name"], self.server.qa_state.records[0]["name"])
        self.assertEqual(len(self.server.qa_state.records), 1)

    def test_rejection_and_network_failure_store_no_record(self):
        self.request("/__qa/control", {"employee": self.employee, "nextAttendance": {"behavior": "reject"}})
        status, _ = self.punch()
        self.assertEqual(status, 422)
        self.request("/__qa/control", {"employee": self.employee, "network": "503"})
        status, _ = self.punch()
        self.assertEqual(status, 503)
        status, _ = self.request("/__qa/state")
        self.assertEqual(status, 200)
        self.assertEqual(self.server.qa_state.records, [])


if __name__ == "__main__":
    unittest.main()
