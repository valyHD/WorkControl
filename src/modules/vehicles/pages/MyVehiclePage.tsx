import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../../providers/AuthProvider";
import { getMyVehicleForUser } from "../services/vehiclesService";

export default function MyVehiclePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    async function resolveVehicle() {
      if (!user?.uid) return;

      const myVehicle = await getMyVehicleForUser(user.uid);
      if (!mounted) return;

      if (myVehicle) {
        navigate(`/vehicles/${myVehicle.id}?view=my-vehicle`, { replace: true });
        return;
      }

      navigate("/vehicles", { replace: true });
    }

    void resolveVehicle();

    return () => {
      mounted = false;
    };
  }, [navigate, user?.uid]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="placeholder-page">
      <h2>Se cauta masina ta...</h2>
      <p>Te redirectionam automat catre masina personala sau lista de masini.</p>
    </div>
  );
}
