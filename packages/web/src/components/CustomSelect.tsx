import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";

export interface CustomSelectOption<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface CustomSelectProps<T extends string | number> {
  value: T;
  options: readonly CustomSelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

interface DropdownPos {
  top: number;
  left: number;
  width: number;
  openUpward: boolean;
}

const DROPDOWN_MAX_HEIGHT = 260;
const DROPDOWN_MARGIN = 6;

export function CustomSelect<T extends string | number>({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  className,
  ariaLabel,
}: CustomSelectProps<T>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<DropdownPos | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function calcPos(): DropdownPos | null {
    if (!triggerRef.current) return null;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - DROPDOWN_MARGIN;
    const spaceAbove = rect.top - DROPDOWN_MARGIN;
    const openUpward = spaceBelow < DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow;
    const top = openUpward
      ? rect.top - DROPDOWN_MARGIN - Math.min(DROPDOWN_MAX_HEIGHT, spaceAbove)
      : rect.bottom + DROPDOWN_MARGIN;
    return { top, left: rect.left, width: rect.width, openUpward };
  }

  // Recalculate position when dropdown opens.
  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownPos(null);
      return;
    }
    setDropdownPos(calcPos());
  }, [isOpen]);

  // Resize: recalculate; scroll (capture phase): close to avoid stale position.
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => setDropdownPos(calcPos());
    const handleScroll = () => setIsOpen(false);

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, { capture: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption?.label ?? placeholder ?? "";

  const rootClass = `custom-select${isOpen ? " is-open" : ""}${className ? ` ${className}` : ""}`;

  return (
    <div className={rootClass} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!disabled) {
              setIsOpen((prev) => !prev);
            }
          }
        }}
      >
        <span className="custom-select-value">{displayLabel}</span>
        <span className="custom-select-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {isOpen && dropdownPos !== null && (
        <ul
          className={`custom-select-dropdown${dropdownPos.openUpward ? " opens-upward" : ""}`}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
          }}
        >
          {options.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled}
              title={option.title}
              className={`custom-select-option${option.value === value ? " is-selected" : ""}`}
              onClick={() => {
                if (!option.disabled) {
                  onChange(option.value);
                  setIsOpen(false);
                }
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
