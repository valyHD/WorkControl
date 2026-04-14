import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AppUser, ToolFormValues } from "../../../types/tool";
import ToolForm from "../components/ToolForm";
import {
  addToolEvent,
  createTool,
  getToolById,
  getUsersList,
  isInternalCodeUsed,
  isQrCodeUsed,
  saveToolImages,
  updateTool,
  uploadToolImages,
} from "../services/toolsService";
import { useAuth } from "../../../providers/AuthProvider";

const emptyValues: ToolFormValues = {
  name: "",
  internalCode: "",
  qrCodeValue: "",
  status: "depozit",
  coverThumbUrl: "",

  ownerUserId: "",
  ownerUserName: "",
  ownerThemeKey: null,

  currentHolderUserId: "",
  currentHolderUserName: "",
  currentHolderThemeKey: null,

  locationType: "depozit",
  locationLabel: "Depozit",

  description: "",
  warrantyText: "",
  warrantyUntil: "",

  coverImageUrl: "",
  imageUrls: [],
  images: [],
};

export default function ToolFormPage() {
  const { toolId } = useParams();
  const isEdit = Boolean(toolId);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [initialValues, setInitialValues] = useState<ToolFormValues>(emptyValues);
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
        const usersData = await getUsersList();
        setUsers(usersData);

        if (toolId) {
          const tool = await getToolById(toolId);

          if (tool) {
            if (user?.uid && tool.ownerUserId && tool.ownerUserId !== user.uid) {
              setForbidden(true);
              return;
            }

            setInitialValues({
              name: tool.name,
              internalCode: tool.internalCode,
              qrCodeValue: tool.qrCodeValue,
              status: tool.status,
              coverThumbUrl: tool.coverThumbUrl,

              ownerUserId: tool.ownerUserId,
              ownerUserName: tool.ownerUserName,
              ownerThemeKey: tool.ownerThemeKey ?? null,

              currentHolderUserId: tool.currentHolderUserId,
              currentHolderUserName: tool.currentHolderUserName,
              currentHolderThemeKey: tool.currentHolderThemeKey ?? null,

              locationType: tool.locationType,
              locationLabel: tool.locationLabel,

              description: tool.description,
              warrantyText: tool.warrantyText,
              warrantyUntil: tool.warrantyUntil,

              coverImageUrl: tool.coverImageUrl,
              imageUrls: tool.imageUrls,
              images: tool.images,
            });
          }
        } else {
          setInitialValues({
            ...emptyValues,
            ownerUserId: user?.uid ?? "",
            ownerUserName: user?.displayName ?? "",
            ownerThemeKey: user?.themeKey ?? null,

            currentHolderUserId: user?.uid ?? "",
            currentHolderUserName: user?.displayName ?? "",
            currentHolderThemeKey: user?.themeKey ?? null,

            locationType: user?.uid ? "utilizator" : "depozit",
            locationLabel: user?.displayName || "Depozit",
            status: user?.uid ? "atribuita" : "depozit",
          });
        }
      } catch (err) {
        console.error(err);
        setError("Nu am putut incarca formularul.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [toolId, user]);

  async function handleSubmit(values: ToolFormValues, selectedFiles: File[]) {
    setSubmitting(true);
    setError("");

    try {
      const cleanName = values.name.trim();
      const cleanInternalCode = values.internalCode.trim();
      const cleanQr = values.qrCodeValue.trim();

      if (!cleanName) {
        setError("Completeaza numele sculei.");
        return;
      }

      if (!cleanInternalCode) {
        setError("Completeaza codul intern.");
        return;
      }

      if (!values.ownerUserId) {
        setError("Selecteaza responsabilul principal.");
        return;
      }

      const internalCodeExists = await isInternalCodeUsed(cleanInternalCode, toolId);
      if (internalCodeExists) {
        setError("Exista deja o scula cu acest cod intern.");
        return;
      }

      if (cleanQr) {
        const qrExists = await isQrCodeUsed(cleanQr, toolId);
        if (qrExists) {
          setError("Exista deja o scula cu acest cod QR asociat.");
          return;
        }
      }

      const selectedOwner =
        users.find((item) => item.id === values.ownerUserId) ?? null;

      const selectedHolder =
        users.find((item) => item.id === values.currentHolderUserId) ?? null;

      const normalizedValues: ToolFormValues = {
        ...values,
        name: cleanName,
        internalCode: cleanInternalCode,
        qrCodeValue: cleanQr,

        ownerUserName:
          selectedOwner?.fullName || values.ownerUserName || "",
        ownerThemeKey:
          selectedOwner?.themeKey ?? values.ownerThemeKey ?? null,

        currentHolderUserName:
          selectedHolder?.fullName || values.currentHolderUserName || "",
        currentHolderThemeKey:
          selectedHolder?.themeKey ?? values.currentHolderThemeKey ?? null,

        locationType: values.currentHolderUserId ? "utilizator" : "depozit",
        locationLabel: values.currentHolderUserId
          ? selectedHolder?.fullName || values.currentHolderUserName || "Utilizator"
          : "Depozit",

        status: values.currentHolderUserId
          ? values.status === "defecta" || values.status === "pierduta"
            ? values.status
            : "atribuita"
          : values.status === "defecta" || values.status === "pierduta"
            ? values.status
            : "depozit",

        description: values.description.trim(),
        warrantyText: values.warrantyText.trim(),
      };

      if (!toolId) {
        const newToolId = await createTool(normalizedValues);

        if (selectedFiles.length > 0) {
          const uploaded = await uploadToolImages(newToolId, selectedFiles);
          await saveToolImages(newToolId, [], uploaded);
        }

        await addToolEvent(
          newToolId,
          "updated",
          "Datele initiale ale sculei au fost salvate."
        );

        navigate(`/tools/${newToolId}`);
        return;
      }

      await updateTool(toolId, normalizedValues);

      if (selectedFiles.length > 0) {
        const uploaded = await uploadToolImages(toolId, selectedFiles);
        await saveToolImages(toolId, normalizedValues.images, uploaded);
      }

      navigate(`/tools/${toolId}`);
    } catch (err) {
      console.error(err);
      setError("Nu am putut salva scula. Verifica datele si regulile Firebase.");
    } finally {
      setSubmitting(false);
    }
  }

  const title = useMemo(
    () => (isEdit ? "Editeaza scula" : "Adauga scula"),
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
        <h2>Nu poti edita aceasta scula</h2>
        <p>Doar responsabilul principal poate modifica aceasta scula.</p>
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
              Completeaza datele principale, responsabilul, detinatorul si pozele.
            </p>
          </div>

          <Link to="/tools" className="secondary-btn">
            Inapoi la lista
          </Link>
        </div>

        {error && <div className="tool-message">{error}</div>}

        <ToolForm
          initialValues={initialValues}
          users={users}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      </div>
    </section>
  );
}