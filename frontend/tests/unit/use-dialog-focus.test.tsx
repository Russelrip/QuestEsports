import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useDialogFocus } from "@/hooks/useDialogFocus";

function Harness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogFocus({ open, onClose: () => setOpen(false) });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Ban Ascent</button>
      <button type="button">Outside</button>
      {open ? (
        <div ref={dialogRef} role="dialog" aria-modal="true">
          <button type="button" onClick={() => setOpen(false)}>Go back</button>
          <button type="button">Confirm ban</button>
        </div>
      ) : null}
    </>
  );
}

afterEach(() => cleanup());

describe("useDialogFocus", () => {
  it("moves focus into the dialog when it opens", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Ban Ascent" }));

    expect(screen.getByRole("button", { name: "Go back" })).toHaveFocus();
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Ban Ascent" }));

    await user.tab();
    expect(screen.getByRole("button", { name: "Confirm ban" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Go back" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Confirm ban" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to what opened it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Ban Ascent" });
    await user.click(opener);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});
