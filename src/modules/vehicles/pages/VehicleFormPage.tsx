import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AppUser } from "../../../types/tool";
import type { VehicleFormValues } from "../../../types/vehicle";
import VehicleForm from "../components/VehicleForm";
import type { VehiclePendingDocument } from "../components/VehicleDocumentUploader";
import {
  createVehicle,
  getVehicleById,
  getVehicleUsers,
  isPlateNumberUsed,
  saveVehicleImages,
  saveVehicleDocuments,
  updateVehicle,
  uploadVehicleImages,
  uploadVehicleDocuments,
} from "../services/vehiclesService";
import { useAuth } from "../../../providers/AuthProvider";

const emptyValues: VehicleFormValues = {
  plateNumber: "",
  brand: "",
  model: "",
  year: "",
  vin: "",
  fuelType: "",
  status: "activa",
  currentKm: 0,
  initialRecordedKm: 0,

  ownerUserId: "",
  ownerUserName: "",
  ownerThemeKey: null,

  currentDriverUserId: "",
  currentDriverUserName: "",
  currentDriverThemeKey: null,

  maintenanceNotes: "",
  serviceStrategy: "interval",
  serviceIntervalKm: 15000,
  nextServiceKm: 0,
  nextItpDate: "",
  nextRcaDate: "",
  nextCascoDate: "",

  coverImageUrl: "",
  coverThumbUrl: "",
  images: [],
  documents: [],
};

export default function VehicleFormPage() {
  const { vehicleId } = useParams();
  const isEdit = Boolean(vehicleId);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [initialValues, setInitialValues] = useState<VehicleFormValues>(emptyValues);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      setForbidden(false);

      try {
        const usersData = await getVehicleUsers();
        setUsers(usersData);

        if (vehicleId) {
          const vehicle = await getVehicleById(vehicleId);

          if (vehicle) {
            if (user?.uid && vehicle.ownerUserId && vehicle.ownerUserId !== user.uid) {
              setForbidden(true);
              return;
            }

            setInitialValues({
              plateNumber: vehicle.plateNumber,
              brand: vehicle.brand,
              model: vehicle.model,
              year: vehicle.year,
              vin: vehicle.vin,
              fuelType: vehicle.fuelType,
              status: vehicle.status,
              currentKm: vehicle.currentKm,
              initialRecordedKm: vehicle.initialRecordedKm,

              ownerUserId: vehicle.ownerUserId,
              ownerUserName: vehicle.ownerUserName,
              ownerThemeKey: vehicle.ownerThemeKey ?? null,

              currentDriverUserId: vehicle.currentDriverUserId,
              currentDriverUserName: vehicle.currentDriverUserName,
              currentDriverThemeKey: vehicle.currentDriverThemeKey ?? null,

              maintenanceNotes: vehicle.maintenanceNotes,
              serviceStrategy: vehicle.serviceStrategy,
              serviceIntervalKm: vehicle.serviceIntervalKm,
              nextServiceKm: vehicle.nextServiceKm,
              nextItpDate: vehicle.nextItpDate,
              nextRcaDate: vehicle.nextRcaDate,
              nextCascoDate: vehicle.nextCascoDate,

              coverImageUrl: vehicle.coverImageUrl,
              coverThumbUrl: vehicle.coverThumbUrl,
              images: vehicle.images,
              documents: vehicle.documents,
            });
          }
        } else {
          setInitialValues({
            ...emptyValues,
            ownerUserId: user?.uid ?? "",
            ownerUserName: user?.displayName ?? "",
            ownerThemeKey: user?.themeKey ?? null,

            currentDriverUserId: user?.uid ?? "",
            currentDriverUserName: user?.displayName ?? "",
            currentDriverThemeKey: user?.themeKey ?? null,
          });
        }
      } catch (err) {
        console.error(err);
        setError("Nu am putut incarca formularul masinii.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [vehicleId, user]);

  async function handleSubmit(
    values: VehicleFormValues,
    selectedFiles: File[],
    selectedDocuments: VehiclePendingDocument[]
  ) {
    setSubmitting(true);
    setError("");

    try {
      const cleanPlate = values.plateNumber.trim().toUpperCase();
      const cleanBrand = values.brand.trim();
      const cleanModel = values.model.trim();

      if (!cleanPlate) {
        setError("Completeaza numarul de inmatriculare.");
        return;
      }

      if (!cleanBrand || !cleanModel) {
        setError("Completeaza marca si modelul.");
        return;
      }

      const exists = await isPlateNumberUsed(cleanPlate, vehicleId);
      if (exists) {
        setError("Exista deja o masina cu acest numar de inmatriculare.");
        return;
      }

      const selectedOwner =
        users.find((item) => item.id === values.ownerUserId) ?? null;

      const selectedDriver =
        users.find((item) => item.id === values.currentDriverUserId) ?? null;

      const normalizedValues: VehicleFormValues = {
        ...values,
        plateNumber: cleanPlate,
        brand: cleanBrand,
        model: cleanModel,
        vin: values.vin.trim(),
        fuelType: values.fuelType.trim(),
        maintenanceNotes: values.maintenanceNotes.trim(),
        initialRecordedKm: Number(values.initialRecordedKm || values.currentKm || 0),
        serviceIntervalKm: Number(values.serviceIntervalKm || 15000),
        nextServiceKm:
          values.serviceStrategy === "interval"
            ? Number(values.currentKm || 0) + Number(values.serviceIntervalKm || 15000)
            : Number(values.nextServiceKm || 0),

        ownerUserName:
          selectedOwner?.fullName || values.ownerUserName || "",
        ownerThemeKey:
          selectedOwner?.themeKey ?? values.ownerThemeKey ?? null,

        currentDriverUserName:
          selectedDriver?.fullName || values.currentDriverUserName || "",
        currentDriverThemeKey:
          selectedDriver?.themeKey ?? values.currentDriverThemeKey ?? null,
      };

      if (!vehicleId) {
        const newVehicleId = await createVehicle(normalizedValues);

        if (selectedFiles.length > 0) {
          const uploaded = await uploadVehicleImages(newVehicleId, selectedFiles);
          await saveVehicleImages(newVehicleId, [], uploaded);
        }

        if (selectedDocuments.length > 0) {
          const uploadedDocs = await uploadVehicleDocuments(newVehicleId, selectedDocuments);
          await saveVehicleDocuments(newVehicleId, [], uploadedDocs);
        }

        navigate(`/vehicles/${newVehicleId}`);
        return;
      }

      await updateVehicle(vehicleId, normalizedValues);

      if (selectedFiles.length > 0) {
        const uploaded = await uploadVehicleImages(vehicleId, selectedFiles);
        await saveVehicleImages(vehicleId, normalizedValues.images, uploaded);
      }

      if (selectedDocuments.length > 0) {
        const uploadedDocs = await uploadVehicleDocuments(vehicleId, selectedDocuments);
        await saveVehicleDocuments(vehicleId, normalizedValues.documents, uploadedDocs);
      }

      navigate(`/vehicles/${vehicleId}`);
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva masina.");
    } finally {
      setSubmitting(false);
    }
  }

  const title = useMemo(
    () => (isEdit ? "Editeaza masina" : "Adauga masina"),
    [isEdit]
  );

  if (loading) {
    return (
      <div className="placeholder-page">
        <h2>Se incarca formularul...</h2>
        <p>Pregatim datele necesare.</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="placeholder-page">
        <h2>Nu poti edita aceasta masina</h2>
        <p>Doar responsabilul principal poate modifica aceasta masina.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <div className="panel">
        <div className="tools-header">
          <div>
            <h2 className="panel-title">{title}</h2>
            <p className="tools-subtitle">
              Completeaza datele masinii, responsabilul, soferul si mentenanta.
            </p>
          </div>

          <Link to="/vehicles" className="secondary-btn">
            Inapoi la masini
          </Link>
        </div>

        {error && <div className="tool-message">{error}</div>}

        <VehicleForm
          initialValues={initialValues}
          users={users}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      </div>
    </section>
  );
}
