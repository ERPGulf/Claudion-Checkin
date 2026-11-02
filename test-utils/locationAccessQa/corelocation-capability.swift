import CoreLocation
import Foundation
let result: [String: Any] = [
  "observedAt": ISO8601DateFormatter().string(from: Date()),
  "regionMonitoringAvailable": CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self),
  "locationServicesEnabled": CLLocationManager.locationServicesEnabled(),
  "significantLocationChangeMonitoringAvailable": CLLocationManager.significantLocationChangeMonitoringAvailable()
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)
