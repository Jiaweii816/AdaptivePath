import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { onboardingOptions } from "@/features/onboarding/profile-defaults";
import { updateProfileSelections } from "@/features/profile/actions";
import type { SelfReportedSelections } from "../ledger-types";

function CheckboxGroup({
  name,
  options,
  selected,
  title,
}: {
  name: string;
  options: readonly string[];
  selected: string[];
  title: string;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="text-sm font-semibold">{title}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
            key={option}
          >
            <input
              className="h-4 w-4 accent-primary"
              defaultChecked={selected.includes(option)}
              name={name}
              type="checkbox"
              value={option}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Edits the self-reported side only; it never touches the evidence ledger. */
export function SignalEditor({
  selections,
}: {
  selections: SelfReportedSelections;
}) {
  return (
    <section className="mt-8" id="edit-signals">
      <div className="rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Edit self-reported signals</h2>
        <p className="mt-1 max-w-[76ch] text-[12.5px] text-muted-foreground">
          These feed the comparison above. Changing them never alters the evidence
          ledger.
        </p>
        <form action={updateProfileSelections} className="mt-4 grid gap-5">
          <CheckboxGroup
            name="strongPatterns"
            options={onboardingOptions.strongPatterns}
            selected={selections.strongPatterns}
            title="Strong patterns"
          />
          <CheckboxGroup
            name="weakPatterns"
            options={onboardingOptions.weakPatterns}
            selected={selections.weakPatterns}
            title="Weak patterns"
          />
          <CheckboxGroup
            name="outputPreferences"
            options={onboardingOptions.outputPreferences}
            selected={selections.outputPreferences}
            title="Output preference"
          />
          <div className="border-t border-border pt-4">
            <Button type="submit">
              <Save aria-hidden="true" className="h-4 w-4" />
              Save profile
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
