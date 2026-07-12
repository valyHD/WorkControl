export type WorkControlReleaseNote = {
  version: string;
  releasedAt: string;
  title: string;
  items: string[];
};

export const WORKCONTROL_RELEASE_NOTES: WorkControlReleaseNote[] = [
  {
    version: "2026.07.12-v4",
    releasedAt: "2026-07-12",
    title: "Product intelligence si lucru asistat",
    items: [
      "Inbox operational si notificari prioritizate.",
      "Filtre salvate, onboarding si ajutor contextual.",
      "Mod offline pentru pontaj si bonuri.",
      "Feature flags, analytics cu acord si health monitoring.",
    ],
  },
  {
    version: "2026.07.12-v3",
    releasedAt: "2026-07-12",
    title: "Assistant V3 controlat",
    items: [
      "Plan, validare si confirmare inainte de executie.",
      "150 de scenarii romanesti si observabilitate admin.",
      "Fallback audio OpenAI numai cu acord explicit.",
    ],
  },
];
