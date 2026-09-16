"use client";
import { useState } from "react";
import { ArrangementTypeForm } from "@/components/arrangement-type-form";
import {
  Page,
  Panel,
  Collection,
  Editor,
  Form,
  TextField,
  Empty,
  Action,
  WorkspaceTabs,
  textValue,
} from "@/components/record-ui";
const seed = [
  ["Morgan household", "Household"],
  ["Alex Morgan", "Person"],
  ["Jamie Morgan", "Person"],
  ["Riley Morgan", "Person"],
  ["Sam Morgan", "Person"],
  ["Home · Oak Street", "Property"],
  ["Lakeside rental", "Property"],
  ["Maple Avenue rental", "Property"],
  ["Family car", "Vehicle"],
  ["Morgan Properties LLC", "Organization"],
  ["Northwind Studio", "Organization"],
  ["Home renovation", "Project"],
  ...Array.from({ length: 13 }, (_, i) => [`Sample asset ${i + 1}`, "Asset"]),
].map(([name, kind], i) => ({ id: String(i), name, kind }));
export default function Preview() {
  const [rows, setRows] = useState(seed);
  return (
    <div className="p-4 sm:p-8">
      <Page
        title="Entities"
        description="The people, places, and things in your life. Keep their details and history together."
        actions={
          <Editor title="New entity">
            <Form
              label="Create entity"
              onSave={async (data) => {
                if (textValue(data, "name") === "error")
                  throw Error("A test failure. Your draft is preserved.");
                setRows([
                  ...rows,
                  {
                    id: String(Date.now()),
                    name: textValue(data, "name"),
                    kind: textValue(data, "kind"),
                  },
                ]);
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Display name" name="name" required />
                <TextField
                  label="Kind"
                  name="kind"
                  value="Person"
                  required
                  hint="For example: Person, Household, or Vehicle."
                />
              </div>
            </Form>
          </Editor>
        }
      >
        <WorkspaceTabs
          tabs={[
            {
              label: "All records",
              content: rows.length ? (
                <Collection label="entities">
                  {rows.map((row) => (
                    <Panel key={row.id} title={row.name} category={row.kind}>
                      <Editor title="Edit entity" inline>
                        <Form
                          onSave={async (data) =>
                            setRows(
                              rows.map((r) =>
                                r.id === row.id
                                  ? {
                                      ...r,
                                      name: textValue(data, "name"),
                                      kind: textValue(data, "kind"),
                                    }
                                  : r,
                              ),
                            )
                          }
                        >
                          <TextField
                            label="Display name"
                            name="name"
                            value={row.name}
                            required
                          />
                          <TextField
                            label="Kind"
                            name="kind"
                            value={row.kind}
                            required
                          />
                        </Form>
                      </Editor>
                      <Editor title="Details & history">
                        <p>Notes and history for {row.name}.</p>
                        <Editor title="Add note">
                          <Form onSave={async () => {}}>
                            <TextField label="Note" name="note" />
                          </Form>
                        </Editor>
                      </Editor>
                      <Action
                        confirm="Archive this entity?"
                        onClick={async () =>
                          setRows(rows.filter((r) => r.id !== row.id))
                        }
                      >
                        Archive
                      </Action>
                    </Panel>
                  ))}
                </Collection>
              ) : (
                <Empty>No entities yet. Create your first entity.</Empty>
              ),
            },
            {
              label: "Empty state",
              content: <Empty>No archived records in this dataset.</Empty>,
            },
            {
              label: "Form layout",
              content: (
                <Editor title="New arrangement type">
                  <ArrangementTypeForm save={async () => {}} />
                </Editor>
              ),
            },
          ]}
        />
      </Page>
    </div>
  );
}
