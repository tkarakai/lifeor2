"use client";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import {
  Page,
  Panel,
  Collection,
  Editor,
  Empty,
  Loading,
} from "@/components/record-ui";
import { ArrangementTypeForm } from "@/components/arrangement-type-form";
import { RecordDetails } from "@/components/record-details";
export default function TypesPage() {
  const types = useQuery(api.arrangements.listTypes);
  const create = useMutation(api.arrangements.createType);
  const update = useMutation(api.arrangements.updateType);
  return (
    <Page
      title="Arrangement types"
      description="Create your own types and suggested participant or subject roles."
      actions={
        <>
          <Editor title="New arrangement type">
            <ArrangementTypeForm
              save={(name, templates) => create({ name, templates })}
            />
          </Editor>
        </>
      }
    >
      {types === undefined ? (
        <Loading />
      ) : types.length === 0 ? (
        <Empty>No types yet. Create a type before adding an arrangement.</Empty>
      ) : (
        <Collection label="types">
          {types.map((type) => (
            <Panel
              key={type._id}
              title={type.name}
              summary={`${type.templates.length} ${type.templates.length === 1 ? "role" : "roles"}`}
              summaryLabel="Templates"
              description={
                type.templates.length
                  ? type.templates
                      .map((role) => `${role.name} (${role.participation})`)
                      .join(" · ")
                  : "No role templates defined"
              }
            >
              <ArrangementTypeForm
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
          ))}
        </Collection>
      )}
    </Page>
  );
}
