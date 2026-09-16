"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Page,
  Panel,
  Form,
  TextField,
  Field,
  Editor,
  Empty,
  Loading,
  controlClass,
  textValue,
} from "@/components/record-ui";
import { Button } from "@/components/ui/button";
import { RecordDetails } from "@/components/record-details";
type Template = {
  name: string;
  participation: "participant" | "subject";
  eligibleKinds?: string[];
};
function TypeForm({
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
      <p className="text-sm text-muted-foreground">
        Templates are copied when a new arrangement is created. Existing
        arrangements keep their local roles.
      </p>
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid gap-3 rounded-md border p-3 sm:grid-cols-3"
        >
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
          <Button
            type="button"
            variant="outline"
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
          >
            Remove template
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          setRows([...rows, { name: "", participation: "participant" }])
        }
      >
        Add role template
      </Button>
    </Form>
  );
}
export default function TypesPage() {
  const types = useQuery(api.arrangements.listTypes);
  const create = useMutation(api.arrangements.createType);
  const update = useMutation(api.arrangements.updateType);
  return (
    <Page
      title="Arrangement types"
      description="Create your own types and suggested participant or subject roles."
    >
      <Editor title="New arrangement type">
        <TypeForm save={(name, templates) => create({ name, templates })} />
      </Editor>
      {types === undefined ? (
        <Loading />
      ) : types.length === 0 ? (
        <Empty>No types yet. Create a type before adding an arrangement.</Empty>
      ) : (
        types.map((type) => (
          <Panel key={type._id} title={type.name}>
            <TypeForm
              key={JSON.stringify(type)}
              name={type.name}
              templates={type.templates}
              save={(name, templates) =>
                update({
                  id: type._id,
                  name,
                  templates,
                  expectedRevision: type.revision,
                })
              }
            />
            <RecordDetails
              target={{ kind: "arrangement_type", id: type._id }}
            />
          </Panel>
        ))
      )}
    </Page>
  );
}
