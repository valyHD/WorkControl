import { useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  LayoutGrid,
  Plus,
  Settings2,
} from "lucide-react";
import { useAuth } from "../../../providers/AuthProvider";
import {
  ContentGrid,
  DetailsDrawer,
  EmptyState,
  ErrorState,
  FilterDrawer,
  FormSection,
  InlineError,
  KpiCard,
  KpiGrid,
  LoadingState,
  MobileActionSheet,
  OfflineState,
  PageHeader,
  PageLayout,
  PageTabs,
  PageToolbar,
  PermissionState,
  Skeleton,
  StaleState,
  StickyActionBar,
} from "../../../components/experience";

const tabs = [
  { id: "components", label: "Componente", icon: LayoutGrid },
  { id: "states", label: "Stari", icon: Info },
  { id: "forms", label: "Formulare", icon: Settings2 },
];

export default function UiLabPage() {
  const { role } = useAuth();
  const [activeTab, setActiveTab] = useState("components");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  if (role !== "admin") return <PermissionState />;

  return (
    <PageLayout className="wc-ui-lab" data-assistant-section="ui-lab">
      <PageHeader
        eyebrow="Control Panel"
        title="UI Lab"
        description="Catalog intern pentru tokenuri, componente, stari si comportament responsive."
        actions={[
          { id: "drawer", label: "Deschide drawer", icon: Settings2, onClick: () => setDrawerOpen(true) },
          { id: "filters", label: "Filtre", icon: Settings2, onClick: () => setFilterOpen(true) },
          { id: "sheet", label: "Actiuni mobile", icon: Plus, tone: "primary", onClick: () => setSheetOpen(true) },
        ]}
      />

      <PageTabs items={tabs} activeId={activeTab} onChange={setActiveTab} label="Exemple UI Lab" />

      {activeTab === "components" ? (
        <>
          <KpiGrid>
            <KpiCard label="Actiune" value="24" helper="Albastru" icon={LayoutGrid} />
            <KpiCard label="Succes" value="18" helper="Verde" icon={CheckCircle2} tone="green" />
            <KpiCard label="Atentie" value="4" helper="Portocaliu" icon={AlertTriangle} tone="orange" />
            <KpiCard label="Critic" value="2" helper="Rosu" icon={Bell} tone="red" />
          </KpiGrid>
          <ContentGrid columns="main-aside">
            <article className="wc-card">
              <h2 className="wc-section-title">Toolbar si actiuni</h2>
              <PageToolbar>
                <button type="button" className="primary-btn"><Plus size={16} /> Actiune principala</button>
                <button type="button" className="secondary-btn">Actiune secundara</button>
              </PageToolbar>
            </article>
            <EmptyState title="Nu exista rezultate" subtitle="Schimba filtrele sau creeaza primul element." action={<button type="button" className="secondary-btn"><Plus size={15} /> Creeaza</button>} />
          </ContentGrid>
        </>
      ) : null}

      {activeTab === "states" ? (
        <div className="wc-ui-lab__states">
          <Skeleton lines={4} />
          <LoadingState />
          <ErrorState description="Exemplu de eroare la nivel de pagina." retry={() => undefined} />
          <InlineError message="Datele nu au putut fi incarcate." retry={() => undefined} />
          <StaleState updatedLabel="acum 12 minute" retry={() => undefined} />
          <OfflineState retry={() => undefined} />
          <PermissionState message="Exemplu de stare pentru continut restrictionat." />
        </div>
      ) : null}

      {activeTab === "forms" ? (
        <form className="wc-ui-lab__form" onSubmit={(event) => event.preventDefault()}>
          <FormSection step="1" title="Date principale" description="Campuri grupate dupa intentie.">
            <label>Nume<input className="tool-input" placeholder="Exemplu" /></label>
            <label>Status<select className="tool-input" defaultValue="activ"><option value="activ">Activ</option><option value="inactiv">Inactiv</option></select></label>
          </FormSection>
          <StickyActionBar>
            <button type="button" className="secondary-btn">Anuleaza</button>
            <button type="submit" className="primary-btn">Salveaza</button>
          </StickyActionBar>
        </form>
      ) : null}

      <DetailsDrawer open={drawerOpen} title="Detalii" description="Drawer accesibil cu focus trap si inchidere la Escape." onClose={() => setDrawerOpen(false)}>
        <p>Continutul ramane separat de pagina principala si este usor de parcurs.</p>
      </DetailsDrawer>
      <MobileActionSheet open={sheetOpen} title="Actiuni rapide" description="Pe mobil apare din partea de jos." onClose={() => setSheetOpen(false)}>
        <button type="button" className="primary-btn" onClick={() => setSheetOpen(false)}>Confirma</button>
      </MobileActionSheet>
      <FilterDrawer open={filterOpen} title="Filtre lista" description="Filtrele secundare raman in afara continutului principal." onClose={() => setFilterOpen(false)}>
        <label>Status<select className="tool-input" defaultValue="toate"><option value="toate">Toate</option><option value="activ">Active</option></select></label>
        <button type="button" className="primary-btn" onClick={() => setFilterOpen(false)}>Aplica filtrele</button>
      </FilterDrawer>
    </PageLayout>
  );
}
