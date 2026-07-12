export type DashboardRoleProfile = {
  eyebrow: string;
  title: string;
  description: string;
};

export function getDashboardRoleProfile(role: string): DashboardRoleProfile {
  if (role === "admin") {
    return {
      eyebrow: "Command Center administrare",
      title: "Ce se intampla azi in firma",
      description: "Pontaje, flota, mentenanta, alerte si costuri intr-o singura privire.",
    };
  }

  if (role === "manager") {
    return {
      eyebrow: "Command Center echipa",
      title: "Echipa si lucrarile de azi",
      description: "Pontaje active, proiecte, mentenanta si situatii care necesita atentie.",
    };
  }

  return {
    eyebrow: "Spatiul meu de lucru",
    title: "Activitatea mea de azi",
    description: "Pontajul, proiectele, masina si notificarile tale importante.",
  };
}
