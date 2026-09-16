"use client";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import {
  Page,
  Panel,
  Form,
  TextField,
  Editor,
  Action,
  Empty,
  Loading,
  textValue,
} from "@/components/record-ui";
import { RecordDetails } from "@/components/record-details";
export default function EntitiesPage() {
  const entities = useQuery(api.entities.list);
  const create = useMutation(api.entities.create);
  const update = useMutation(api.entities.update);
  const remove = useMutation(api.entities.remove);
  return (
    <Page
      title="Entities"
      description="Identify a specific person, organization, animal, service, or asset. Roles belong to arrangements."
    >
      <Editor title="New entity">
        <Form
          label="Create entity"
          onSave={(data) =>
            create({
              display_name: textValue(data, "name"),
              kind: textValue(data, "kind"),
            })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Display name" name="name" required />
            <TextField
              label="Kind"
              name="kind"
              value="Person"
              required
              hint="Use any descriptive kind, such as Person, Household, or Vehicle."
            />
          </div>
        </Form>
      </Editor>
      {entities === undefined ? (
        <Loading />
      ) : entities.length === 0 ? (
        <Empty>No entities yet. Create the first one above.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {entities.map((entity) => (
            <Panel
              key={entity._id}
              title={entity.display_name}
              description={entity.kind}
            >
              <Editor title="Edit entity">
                <Form
                  onSave={(data) =>
                    update({
                      id: entity._id,
                      expectedRevision: entity.revision,
                      display_name: textValue(data, "name"),
                      kind: textValue(data, "kind"),
                    })
                  }
                >
                  <TextField
                    label="Display name"
                    name="name"
                    value={entity.display_name}
                    required
                  />
                  <TextField
                    label="Kind"
                    name="kind"
                    value={entity.kind}
                    required
                  />
                </Form>
              </Editor>
              <RecordDetails target={{ kind: "entity", id: entity._id }} />
              <Action
                confirm="Archive this entity? Historical references are retained."
                onClick={() => remove({ id: entity._id })}
              >
                Archive
              </Action>
            </Panel>
          ))}
        </div>
      )}
    </Page>
  );
}
