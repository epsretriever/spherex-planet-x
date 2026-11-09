import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIELD_PAGE, FieldGrid } from "./FieldGrid";

const fields = Array.from({ length: 60 }, (_, i) => ({ field_id: `f-${i}` }));

vi.mock("@/lib/useData", () => ({
  useData: () => ({ status: "ok", data: { fields } }),
}));
vi.mock("./FieldCard", () => ({
  FieldCard: ({ field }: { field: { field_id: string } }) => <li>{field.field_id}</li>,
}));

describe("FieldGrid", () => {
  it("shows the patches a page at a time instead of all at once", () => {
    render(<FieldGrid />);
    expect(screen.getAllByRole("listitem")).toHaveLength(FIELD_PAGE);
    expect(screen.getByText(/patches of sky\./)).toHaveTextContent(`Showing ${FIELD_PAGE} of 60 patches of sky.`);

    fireEvent.click(screen.getByRole("button", { name: `Show ${FIELD_PAGE} more` }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2 * FIELD_PAGE);

    fireEvent.click(screen.getByRole("button", { name: "Show 12 more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(60);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps a fixed limit with no button (home page preview)", () => {
    render(<FieldGrid limit={3} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
