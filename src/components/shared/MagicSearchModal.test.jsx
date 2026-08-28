import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MagicSearchModal } from "./MagicSearchModal";

describe("MagicSearchModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<MagicSearchModal open={false} response="hi" onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the response markdown when open", () => {
    render(<MagicSearchModal open response="Hello world" onClose={() => {}} />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText(/Magic Search Results/i)).toBeInTheDocument();
  });

  it("shows a fallback when there is no response", () => {
    render(<MagicSearchModal open response="" onClose={() => {}} />);
    expect(screen.getByText(/No response generated/i)).toBeInTheDocument();
  });

  it("calls onClose from both the header and footer buttons", () => {
    const onClose = vi.fn();
    render(<MagicSearchModal open response="x" onClose={onClose} />);
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    expect(closeButtons).toHaveLength(2);
    closeButtons.forEach((btn) => fireEvent.click(btn));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
