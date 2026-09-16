import { describe, expect, it } from "vitest";
import { queryTabFocusableElements } from "./focusable";

describe("queryTabFocusableElements", () => {
  it("skips elements inside hidden or inert sections", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section aria-hidden="true" hidden inert>
        <button type="button">Hidden</button>
      </section>
      <button type="button">Visible</button>
    `;
    document.body.appendChild(root);
    const focusables = queryTabFocusableElements(root);
    expect(focusables.map((el) => el.textContent)).toEqual(["Visible"]);
    root.remove();
  });
});
