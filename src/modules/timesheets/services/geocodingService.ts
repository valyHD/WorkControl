import type { TimesheetLocation } from "../../../types/timesheet";
import { simplifyTimesheetAddressLabel } from "../utils/timesheetLocation";

function formatNominatimAddress(data: any, fallback = "") {
  const address = data?.address ?? {};
  const road =
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.cycleway ||
    address.path ||
    "";
  const houseNumber = address.house_number || "";
  const suburb =
    address.suburb ||
    address.neighbourhood ||
    address.city_district ||
    "";
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    "";
  const line1 = [road, houseNumber].filter(Boolean).join(" ").trim();
  const line2 = city || suburb;
  const pretty = [line1, line2].filter(Boolean).join(", ").trim();

  return simplifyTimesheetAddressLabel(pretty || data?.display_name || fallback);
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&addressdetails=1&zoom=18&accept-language=ro` +
      `&lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lng)}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Reverse geocoding failed.");
    }

    const data = await response.json();
    return formatNominatimAddress(data, `${lat}, ${lng}`) || `${lat}, ${lng}`;
  } catch (error) {
    console.error("Eroare reverse geocoding:", error);
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}

export async function geocodeAddress(address: string): Promise<TimesheetLocation | null> {
  const label = simplifyTimesheetAddressLabel(address);
  if (!label) return null;

  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2` +
      `&addressdetails=1&limit=1&accept-language=ro` +
      `&q=${encodeURIComponent(label)}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("Address geocoding failed.");
    }

    const data = await response.json();
    const item = Array.isArray(data) ? data[0] : null;
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { lat: null, lng: null, label };
    }

    return {
      lat,
      lng,
      label: formatNominatimAddress(item, label) || label,
    };
  } catch (error) {
    console.error("Eroare geocoding adresa:", error);
    return { lat: null, lng: null, label };
  }
}
