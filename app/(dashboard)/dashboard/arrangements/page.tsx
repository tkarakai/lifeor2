"use client";
import Link from "next/link";
import { useQuery, useMutation } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Page,
  Panel,
  Editor,
  Form,
  TextField,
  SelectField,
  Action,
  Loading,
  Empty,
  textValue,
  dateValue,
  localDateTime,
  dateLabel,
  options,
} from "@/components/record-ui";
import { RecordDetails } from "@/components/record-details";
function Roles({ arrangementId }: { arrangementId: Id<"arrangement"> }) {
  const definitions = useQuery(api.arrangements.getRoleDefinitions, {
    arrangementId,
  });
  const assignments = useQuery(api.arrangements.getRoles, { arrangementId });
  const entities = useQuery(api.entities.list);
  const create = useMutation(api.arrangements.createRole);
  const update = useMutation(api.arrangements.updateRole);
  const assign = useMutation(api.arrangements.assignRole);
  const updateAssignment = useMutation(api.arrangements.updateAssignment);
  if (!definitions || !assignments || !entities) return <Loading />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Participants take part in the relationship. Subjects are the people or
        assets the relationship concerns.
      </p>
      {definitions
        .filter((role) => !role.archived)
        .map((role) => (
          <div key={role._id} className="space-y-3 rounded-md border p-4">
            <h3 className="font-semibold">
              {role.name}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · {role.participation}
              </span>
            </h3>
            {assignments
              .filter((a) => a.role_definition_id === role._id)
              .map((a) => (
                <div key={a._id} className="space-y-2 border-l-2 pl-3">
                  <p className="text-sm">
                    {entities.find((e) => e._id === a.entity_id)
                      ?.display_name ?? "Archived entity"}{" "}
                    · {dateLabel(a.valid_from)} → {dateLabel(a.valid_to)}
                  </p>
                  <Editor title="Change assignment end">
                    <Form
                      onSave={(data) =>
                        updateAssignment({
                          id: a._id,
                          valid_to: dateValue(data, "end"),
                        })
                      }
                    >
                      <TextField
                        label="End (exclusive)"
                        name="end"
                        type="datetime-local"
                        value={
                          a.valid_to === undefined
                            ? ""
                            : localDateTime(a.valid_to)
                        }
                        required
                      />
                    </Form>
                  </Editor>
                </div>
              ))}
            <Editor title="Assign entity">
              <Form
                label="Assign"
                onSave={(data) =>
                  assign({
                    roleId: role._id,
                    entityId: textValue(data, "entity") as Id<"entity">,
                    valid_from: dateValue(data, "start")!,
                    valid_to: dateValue(data, "end"),
                  })
                }
              >
                <SelectField
                  label="Entity"
                  name="entity"
                  options={entities.map((e) => ({
                    value: e._id,
                    label: `${e.display_name} · ${e.kind}`,
                  }))}
                  required
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Start"
                    name="start"
                    type="datetime-local"
                    value={localDateTime()}
                    required
                  />
                  <TextField
                    label="End (exclusive, optional)"
                    name="end"
                    type="datetime-local"
                  />
                </div>
              </Form>
            </Editor>
            <Editor title="Edit role">
              <Form
                onSave={(data) =>
                  update({ id: role._id, name: textValue(data, "name") })
                }
              >
                <TextField
                  label="Role name"
                  name="name"
                  value={role.name}
                  required
                />
              </Form>
              <Action
                confirm="Archive this role while retaining assignment history?"
                onClick={() => update({ id: role._id, archived: true })}
              >
                Archive role
              </Action>
            </Editor>
          </div>
        ))}
      <Editor title="Add local role">
        <Form
          onSave={(data) =>
            create({
              arrangementId,
              name: textValue(data, "name"),
              participation: textValue(data, "participation") as
                | "participant"
                | "subject",
            })
          }
        >
          <TextField label="Role name" name="name" required />
          <SelectField
            label="Participation"
            name="participation"
            value="participant"
            options={options(["participant", "subject"])}
            required
          />
        </Form>
      </Editor>
    </div>
  );
}
export default function ArrangementsPage() {
  const arrangements = useQuery(api.arrangements.list);
  const types = useQuery(api.arrangements.listTypes);
  const create = useMutation(api.arrangements.create);
  const update = useMutation(api.arrangements.update);
  const remove = useMutation(api.arrangements.remove);
  return (
    <Page
      title="Arrangements"
      description="Continuing relationships and agreements with their own roles and assignments."
    >
      <Link
        className="inline-block text-sm underline underline-offset-4"
        href="/dashboard/arrangements/types"
      >
        Manage types & role templates →
      </Link>
      {types === undefined ? (
        <Loading />
      ) : types.length === 0 ? (
        <Empty>Create an arrangement type first using the link above.</Empty>
      ) : (
        <Editor title="New arrangement">
          <Form
            label="Create arrangement"
            onSave={(data) =>
              create({
                typeId: textValue(data, "type") as Id<"arrangement_type">,
                name: textValue(data, "name"),
                valid_from: dateValue(data, "start")!,
                valid_to: dateValue(data, "end"),
              })
            }
          >
            <TextField label="Name" name="name" required />
            <SelectField
              label="Type"
              name="type"
              required
              options={types.map((t) => ({ value: t._id, label: t.name }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Start"
                name="start"
                type="datetime-local"
                value={localDateTime()}
                required
              />
              <TextField
                label="End (exclusive, optional)"
                name="end"
                type="datetime-local"
              />
            </div>
          </Form>
        </Editor>
      )}
      {arrangements === undefined ? (
        <Loading />
      ) : arrangements.length === 0 ? (
        <Empty>No arrangements yet.</Empty>
      ) : (
        arrangements.map((a) => (
          <Panel
            key={a._id}
            title={a.name || a.kind}
            description={`${a.kind} · ${dateLabel(a.valid_from)} → ${dateLabel(a.valid_to)}`}
          >
            <Editor title="Edit arrangement">
              <Form
                onSave={(data) =>
                  update({
                    id: a._id,
                    name: textValue(data, "name"),
                    lifecycle: textValue(data, "lifecycle") as
                      | "draft"
                      | "active"
                      | "ended",
                    effectiveAt: dateValue(data, "effective")!,
                    expectedRevision: a.revision,
                    valid_to: dateValue(data, "end"),
                  })
                }
              >
                <TextField
                  label="Name"
                  name="name"
                  value={a.name || a.kind}
                  required
                />
                <SelectField
                  label="Lifecycle"
                  name="lifecycle"
                  value={a.lifecycle || "active"}
                  options={options(["draft", "active", "ended"])}
                  required
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Change effective at"
                    name="effective"
                    type="datetime-local"
                    value={localDateTime(Math.max(a.valid_from, Date.now()))}
                    required
                  />
                  <TextField
                    label="End (exclusive, optional)"
                    name="end"
                    type="datetime-local"
                    value={
                      a.valid_to === undefined ? "" : localDateTime(a.valid_to)
                    }
                  />
                </div>
              </Form>
            </Editor>
            <Editor title="Roles & assignments">
              <Roles arrangementId={a._id} />
            </Editor>
            <RecordDetails target={{ kind: "arrangement", id: a._id }} />
            <Action
              confirm="Archive this arrangement? This retains its history and does not change its end date."
              onClick={() => remove({ id: a._id })}
            >
              Archive
            </Action>
          </Panel>
        ))
      )}
    </Page>
  );
}
