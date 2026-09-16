"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Form,
  FormSection,
  TextField,
  Field,
  controlClass,
  textValue,
} from "@/components/record-ui";
import { Button } from "@/components/ui/button";

type Template = {
  name: string;
  participation: "participant" | "subject";
  eligibleKinds?: string[];
};
export function ArrangementTypeForm({
  name = "",
  templates = [],
  save,
}: {
  name?: string;
  templates?: Template[];
  save: (name: string, templates: Template[]) => Promise<unknown>;
}) {
  const [rows, setRows] = useState(templates);
  return (
    <Form onSave={(data) => save(textValue(data, "name"), rows)}>
      <TextField label="Type name" name="name" value={name} required />
      <FormSection
        title="Role templates"
        description="Define the roles each new arrangement starts with. Existing arrangements keep their own roles."
      >
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No templates yet. Add a participant, such as a tenant, or a subject,
            such as a property.
          </p>
        )}
        {rows.map((row, index) => (
          <div key={index} className="record-repeat-row">
            <div className="record-repeat-header">
              <h4>Role {index + 1}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                aria-label={`Remove template ${index + 1}`}
              >
                Remove template
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Role name">
                <input
                  className={controlClass}
                  required
                  value={row.name}
                  onChange={(e) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index ? { ...r, name: e.target.value } : r,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Participation">
                <select
                  className={controlClass}
                  value={row.participation}
                  onChange={(e) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index
                          ? {
                              ...r,
                              participation: e.target
                                .value as Template["participation"],
                            }
                          : r,
                      ),
                    )
                  }
                >
                  <option value="participant">Participant</option>
                  <option value="subject">Subject</option>
                </select>
              </Field>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setRows([...rows, { name: "", participation: "participant" }])
          }
        >
          <Plus size={15} aria-hidden="true" /> Add role template
        </Button>
      </FormSection>
    </Form>
  );
}
