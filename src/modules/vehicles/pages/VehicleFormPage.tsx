import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarCheck, Gauge, Hash, Save } from "lucide-react";
import type { AppUser } from "../../../types/tool";
import type { VehicleFormValues } from "../../../types/vehicle";
import VehicleForm from "../components/VehicleForm";
import type { VehiclePendingDocument } from "../components/VehicleDocumentUploader";
import {
  createVehicle,
  getVehicleById,
  getVehicleUsers,
  isPlateNumberUsed,
  queueVehicleDocumentsForAnalysis,
  saveVehicleImages,
  saveVehicleDocuments,
  updateVehicle,
  uploadVehicleImages,
  uploadVehicleDocuments,
} from "../services/vehiclesService";
import { useAuth } from "../../../providers/AuthProvider";
import ActionBar from "../../../components/ActionBar";
import PageQuickActions from "../../../components/PageQuickActions";
import { ASSISTANT_FILL_VEHICLE_FORM_EVENT } from "../../../lib/assistant/runtime/assistantFormFill";
import { registerAssistantFormDraftAdapter } from "../../../lib/assistant/adapters/assistantFormDraftChannel";

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
  nextRovinietaDate: "",
  nextOilServiceKm: 0,

  coverImageUrl: "",
  coverThumbUrl: "",
  images: [],
  documents: [],
};

const assistantFieldAliases: Record<string, string[]> = {
  currentKm: ["km curenti", "kilometraj actual", "kilometraj curent"],
  initialRecordedKm: ["km reali la inregistrare", "km initiali"],
  nextItpDate: ["itp pana la", "itp"],
  nextRcaDate: ["rca pana la", "rca"],
  nextCascoDate: ["casco pana la", "casco"],
  nextRovinietaDate: ["rovinieta pana la", "rovinieta"],
  serviceIntervalKm: ["revizie la fiecare", "interval service"],
  nextServiceKm: ["prag service"],
  nextOilServiceKm: ["revizie ulei"],
  plateNumber: ["numar inmatriculare"],
  brand: ["marca"],
  model: ["model"],
  vin: ["serie sasiu", "vin"],
  fuelType: ["combustibil"],
  status: ["status"],
};

function normalizeAssistantText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function VehicleFormPage() {
  const { vehicleId } = useParams();
  const isEdit = Boolean(vehicleId);
  const navigate = useNavigate();
  const location = useLocation();
  const { role, user } = useAuth();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [initialValues, setInitialValues] = useState<VehicleFormValues>(emptyValues);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitStatus, setSubmitStatus] = useState("");
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
            if (role !== "admin" && user?.uid && vehicle.ownerUserId && vehicle.ownerUserId !== user.uid) {
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
              nextRovinietaDate: vehicle.nextRovinietaDate,
              nextOilServiceKm: vehicle.nextOilServiceKm,

              coverImageUrl: vehicle.coverImageUrl,
              coverThumbUrl: vehicle.coverThumbUrl,
              images: vehicle.images,
              documents: vehicle.documents,
            });
          }
        } else {
          const params = new URLSearchParams(location.search);
          setInitialValues({
            ...emptyValues,
            plateNumber: (params.get("plate") || "").toUpperCase(),
            brand: params.get("brand") || "",
            model: params.get("model") || "",
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
  }, [location.search, role, vehicleId, user]);

  useEffect(() => {
    if (isEdit) return undefined;
    const handleDraft = (fields: Readonly<Record<string, unknown>>) => {
      setInitialValues((current) => ({
        ...current,
        plateNumber: String(fields.plateNumber ?? current.plateNumber).toUpperCase(),
        brand: String(fields.brand ?? current.brand),
        model: String(fields.model ?? current.model),
        year: String(fields.year ?? current.year),
        vin: String(fields.vin ?? current.vin),
        fuelType: String(fields.fuelType ?? current.fuelType),
        currentKm: fields.currentKm === undefined ? current.currentKm : Number(fields.currentKm),
      }));
    };
    return registerAssistantFormDraftAdapter(ASSISTANT_FILL_VEHICLE_FORM_EVENT, handleDraft);
  }, [isEdit]);

  useEffect(() => {
    if (loading) return;

    const assistantField = new URLSearchParams(location.search).get("assistantField") || "";
    const aliases = assistantFieldAliases[assistantField];
    if (!aliases?.length) return;

    window.setTimeout(() => {
      const normalizedAliases = aliases.map(normalizeAssistantText);
      const label = Array.from(document.querySelectorAll(".tool-form-label")).find((item) => {
        const text = normalizeAssistantText(item.textContent || "");
        return normalizedAliases.some((alias) => text.includes(alias) || alias.includes(text));
      });
      const block = label?.closest(".tool-form-block");
      const control = block?.querySelector("input, select, textarea") as HTMLElement | null;

      (block || control)?.scrollIntoView({ behavior: "smooth", block: "center" });
      control?.focus();
    }, 220);
  }, [loading, location.search]);

  async function handleSubmit(
    values: VehicleFormValues,
    selectedFiles: File[],
    selectedDocuments: VehiclePendingDocument[]
  ) {
    setSubmitting(true);
    setError("");
    setSubmitStatus("");

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
        currentKm: Number(values.currentKm || 0),
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
          setSubmitStatus("Se incarca pozele...");
          const uploaded = await uploadVehicleImages(newVehicleId, selectedFiles);
          await saveVehicleImages(newVehicleId, [], uploaded);
        }

        if (selectedDocuments.length > 0) {
          setSubmitStatus("Se incarca documentele...");
          const uploadedDocs = await uploadVehicleDocuments(newVehicleId, selectedDocuments);
          setSubmitStatus("Se pregateste analiza documentelor...");
          const queuedDocs = await queueVehicleDocumentsForAnalysis(newVehicleId, uploadedDocs);
          await saveVehicleDocuments(newVehicleId, [], queuedDocs);
        }

        navigate(`/vehicles/${newVehicleId}`);
        return;
      }

      await updateVehicle(vehicleId, normalizedValues);

      if (selectedFiles.length > 0) {
        setSubmitStatus("Se incarca pozele...");
        const uploaded = await uploadVehicleImages(vehicleId, selectedFiles);
        await saveVehicleImages(vehicleId, normalizedValues.images, uploaded);
      }

      if (selectedDocuments.length > 0) {
        setSubmitStatus("Se incarca documentele...");
        const uploadedDocs = await uploadVehicleDocuments(vehicleId, selectedDocuments);
        setSubmitStatus("Se pregateste analiza documentelor...");
        const queuedDocs = await queueVehicleDocumentsForAnalysis(vehicleId, uploadedDocs);
        await saveVehicleDocuments(vehicleId, normalizedValues.documents, queuedDocs);
      }

      navigate(`/vehicles/${vehicleId}`);
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva masina.");
    } finally {
      setSubmitting(false);
      setSubmitStatus("");
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
        <p>Doar responsabilul principal sau un administrator poate modifica aceasta masina.</p>
      </div>
    );
  }

  return (
    <section className="page-section">
      <ActionBar
        title={title}
        subtitle={`Completeaza datele masinii, responsabilul, soferul si mentenanta.${submitStatus ? ` ${submitStatus}` : ""}`}
        actions={[
          {
            label: "Inapoi la masini",
            href: "/vehicles",
            icon: <ArrowLeft size={16} />,
            tooltip: "Revino la lista de masini",
          },
        ]}
      />

      <PageQuickActions
        actions={[
          {
            label: "Salveaza",
            href: "#vehicle-save",
            icon: <Save size={16} />,
            assistantAction: "save-vehicle",
            tooltip: "Salveaza masina",
            variant: "primary",
          },
          {
            label: "Numar",
            href: "#vehicle-plateNumber",
            icon: <Hash size={16} />,
            assistantField: "plateNumber",
            tooltip: "Mergi la numarul de inmatriculare",
          },
          {
            label: "Km curenti",
            href: "#vehicle-currentKm",
            icon: <Gauge size={16} />,
            assistantField: "currentKm",
            tooltip: "Mergi la kilometrajul curent",
          },
          {
            label: "ITP",
            href: "#vehicle-nextItpDate",
            icon: <CalendarCheck size={16} />,
            assistantField: "nextItpDate",
            tooltip: "Mergi la data ITP",
          },
        ]}
      />

      <div className="panel" data-assistant-section="vehicle-form">

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
