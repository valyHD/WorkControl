import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "./AssistantPanel";
import { ChoiceCard } from "./ChoiceCard";
import { ConfirmationCard } from "./ConfirmationCard";

describe("Assistant V3 presentational UI", () => {
  it("exposes press-and-hold pointer semantics without submitting on press", () => {
    const onListenStart = vi.fn();
    const onListenEnd = vi.fn();
    render(
      <AssistantPanel
        state="idle"
        onClose={vi.fn()}
        onListenStart={onListenStart}
        onListenEnd={onListenEnd}
      />
    );

    const holdButton = screen.getByRole("button", { name: "Ține apăsat" });
    fireEvent.pointerDown(holdButton, { pointerId: 1 });
    expect(onListenStart).toHaveBeenCalledOnce();
    expect(onListenEnd).not.toHaveBeenCalled();

    fireEvent.pointerUp(holdButton, { pointerId: 1 });
    expect(onListenEnd).toHaveBeenCalledOnce();
  });

  it("renders old-to-new confirmation context and invokes explicit confirmation", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmationCard
        risk="medium"
        confidence={0.92}
        reason="Kilometraj recunoscut din comandă"
        rows={[{ id: "km", label: "Kilometri", oldValue: "6.000", newValue: "6.616" }]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("6.000")).toBeInTheDocument();
    expect(screen.getByText("6.616")).toBeInTheDocument();
    expect(screen.getByText("Încredere 92%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmă" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("presents ambiguous choices as an accessible radio group", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ChoiceCard
        choices={[
          { id: "one", label: "B 33 LGR", description: "Dacia Logan" },
          { id: "two", label: "B 34 LGR", description: "Dacia Spring" },
        ]}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole("radiogroup", { name: "Alege o variantă" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /B 34 LGR/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));
  });

  it("requires an explicit checkbox opt-in before server audio fallback", async () => {
    const onConsentChange = vi.fn();
    const user = userEvent.setup();
    render(
      <AssistantPanel
        state="idle"
        onClose={vi.fn()}
        serverFallbackAvailable
        serverFallbackConsent={false}
        onServerFallbackConsentChange={onConsentChange}
      />
    );

    const consent = screen.getByRole("checkbox", { name: /Permite trimiterea audio/i });
    expect(consent).not.toBeChecked();
    await user.click(consent);
    expect(onConsentChange).toHaveBeenCalledWith(true);
  });

  it("hides the composer while a compact confirmation is pending", () => {
    render(
      <AssistantPanel
        state="confirming"
        showComposer={false}
        onClose={vi.fn()}
        onListenStart={vi.fn()}
        onListenEnd={vi.fn()}
        manualValue=""
        onManualChange={vi.fn()}
        onManualSubmit={vi.fn()}
      >
        <p>Confirmare</p>
      </AssistantPanel>
    );

    expect(screen.getByText("Confirmare")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ține apăsat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trimite comanda" })).not.toBeInTheDocument();
  });
});
