// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// A property's photo on its own page (owner, 2026-10-22: "I want the photo
// upload available in the apartment not the outside … the camera blocks half
// the pic"; "toooo tall"): a small picture beside its card's details, a small
// camera in its corner — or, none yet, the whole box is the button. Filed on
// the property as a צילום.

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
const { offlineUpload } = vi.hoisted(() => ({
  offlineUpload: vi.fn(async (_url: string, _input: unknown) => ({ ok: true, data: { document: { id: "doc-1" } } })),
}));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload }));
const { forgetPropertyPhotos } = vi.hoisted(() => ({ forgetPropertyPhotos: vi.fn() }));
vi.mock("@/app/(app)/properties/propertyPhotos", () => ({ forgetPropertyPhotos }));
URL.createObjectURL = vi.fn(() => "blob:photo");

import { PropertyPhotoBanner } from "@/app/(app)/properties/PropertyPhotoTile";

afterEach(cleanup);

describe("a property's photo on its page", () => {
  it("none yet: the space is the button — the photo filed as a צילום, shown at once, the list told to ask again", async () => {
    const onChanged = vi.fn();
    render(<PropertyPhotoBanner propertyId="p2" name="ריבל 29" url={null} onChanged={onChanged} />);
    const file = new File(["x"], "front.jpg", { type: "image/jpeg" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "הוספת תמונה של הנכס" }));
      fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    });
    expect(offlineUpload).toHaveBeenCalledWith("/api/documents/upload", {
      fields: { business_domain: "property_management", property_id: "p2", category: "צילום" },
      file,
      label: "תמונת ריבל 29",
    });
    expect(screen.getByRole("img", { name: "ריבל 29" })).toHaveAttribute("src", "blob:photo");
    expect(forgetPropertyPhotos).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it("a photo: the picture, with a small camera in its corner to replace it", () => {
    render(<PropertyPhotoBanner propertyId="p1" name="יהודה הנשיא 15" url="https://x/p1.jpg" onChanged={vi.fn()} />);
    expect(screen.getByRole("img", { name: "יהודה הנשיא 15" })).toHaveAttribute("src", "https://x/p1.jpg");
    // Small, in the corner — not over half the picture.
    expect(screen.getByRole("button", { name: "החלפת תמונה" })).toHaveClass("h-7", "w-7");
  });

  it("its files not in yet: a quiet block, nothing to press", () => {
    render(<PropertyPhotoBanner propertyId="p1" name="יהודה הנשיא 15" url={null} ready={false} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
