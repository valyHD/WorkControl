export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
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
    const county = address.county || "";
    const postcode = address.postcode || "";

    const line1 = [road, houseNumber].filter(Boolean).join(" ").trim();
    const line2 = [suburb, city].filter(Boolean).join(", ").trim();
    const line3 = [county, postcode].filter(Boolean).join(", ").trim();

    const pretty = [line1, line2, line3].filter(Boolean).join(" · ").trim();

    return pretty || data?.display_name || `${lat}, ${lng}`;
  } catch (error) {
    console.error("Eroare reverse geocoding:", error);
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}