"use client";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import {
  Page,
  Panel,
  Collection,
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
      description="The people, places, and things in your life. Keep their details and history together."
      actions={
        <>
          <Editor
            title="New entity"
            description="Give this record a recognizable name and a kind to keep your directory organized."
          >
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
        </>
      }
    >
      {entities === undefined ? (
        <Loading />
      ) : entities.length === 0 ? (
        <Empty>No entities yet. Create the first one above.</Empty>
      ) : (
        <Collection label="entities">
          {entities.map((entity) => (
            <Panel
              key={entity._id}
              category={entity.kind}
              title={entity.display_name}
            >
              <Editor title="Edit entity" inline>
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
                  <div className="grid gap-4 sm:grid-cols-2">
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
                      hint="For example: Person, Household, or Vehicle."
                    />
                  </div>
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
        </Collection>
      )}
    </Page>
  );
}
