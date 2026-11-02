package expo.modules.autoattendance

/** GPS quality is never authorization evidence. All readings are tri-state. */
object LocationAccessPolicy {
  data class Access(val state: String, val reason: String? = null)

  fun access(services: Boolean?, foreground: Boolean?, background: Boolean?, precise: Boolean?): Access {
    val checks = listOf(services to "services-disabled", foreground to "foreground-permission-lost",
      precise to "precise-permission-lost", background to "background-permission-lost")
    checks.firstOrNull { it.first == false }?.let { return Access("confirmed_disabled", it.second) }
    return Access(if (checks.all { it.first == true }) "confirmed_available" else "unknown")
  }

  fun presence(distance: Double, accuracy: Double, radius: Double): String {
    if (!distance.isFinite() || distance < 0 || !accuracy.isFinite() || accuracy < 0 ||
      !radius.isFinite() || radius <= 0) return "uncertain"
    return when {
      distance + accuracy <= radius -> "inside"
      distance - accuracy > radius -> "outside"
      else -> "uncertain"
    }
  }

  /** Shared with JS/iOS: metres, spherical haversine, without integer rounding. */
  fun distance(latitude: Double, longitude: Double, otherLatitude: Double, otherLongitude: Double): Double {
    if (!latitude.isFinite() || !longitude.isFinite() || !otherLatitude.isFinite() || !otherLongitude.isFinite() ||
      latitude !in -90.0..90.0 || otherLatitude !in -90.0..90.0 ||
      longitude !in -180.0..180.0 || otherLongitude !in -180.0..180.0) return Double.NaN
    val latitudeDelta = Math.toRadians(otherLatitude - latitude)
    val longitudeDelta = Math.toRadians(otherLongitude - longitude)
    val halfLat = kotlin.math.sin(latitudeDelta / 2)
    val halfLon = kotlin.math.sin(longitudeDelta / 2)
    val haversine = (halfLat * halfLat + kotlin.math.cos(Math.toRadians(latitude)) *
      kotlin.math.cos(Math.toRadians(otherLatitude)) * halfLon * halfLon).coerceIn(0.0, 1.0)
    return 6371000.0 * 2 * kotlin.math.atan2(kotlin.math.sqrt(haversine), kotlin.math.sqrt(1 - haversine))
  }
}
