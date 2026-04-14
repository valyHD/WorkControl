import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import * as L from "leaflet";

type Props = {
  lat: number;
  lng: number;
  label: string;
};

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export default function TimesheetLocationPreviewMap({
  lat,
  lng,
  label,
}: Props) {
  const position: [number, number] = [lat, lng];

  return (
    <div className="timesheet-map-preview">
      <MapContainer
        center={position}
        zoom={16}
        scrollWheelZoom={false}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Marker position={position} icon={markerIcon}>
          <Popup>{label || `${lat}, ${lng}`}</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}