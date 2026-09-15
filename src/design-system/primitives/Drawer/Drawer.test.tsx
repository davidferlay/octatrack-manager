import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  it("calls onClose from Escape and keeps children mounted when closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Drawer open title="Ops" closeAriaLabel="Close" onClose={onClose}>
        <p>Operator body</p>
      </Drawer>,
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Drawer open={false} title="Ops" closeAriaLabel="Close" onClose={onClose}>
        <p>Operator body</p>
      </Drawer>,
    );
    expect(screen.getByText("Operator body")).toBeInTheDocument();
  });
});
