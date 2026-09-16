"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Page,
  Panel,
  Editor,
  Form,
  TextField,
  Action,
  Loading,
  Empty,
  textValue,
} from "@/components/record-ui";
import {
  TargetSelect,
  targetValue,
  useRecordOptions,
} from "@/components/target-select";
import { RecordDetails } from "@/components/record-details";
function Assignments({ tagId }: { tagId: Id<"tag"> }) {
  const assignments = useQuery(api.tags.getAssignments, { tagId });
  const records = useRecordOptions();
  const assign = useMutation(api.tags.assign);
  const unassign = useMutation(api.tags.unassign);
  return (
    <>
      <Form
        label="Add tag to record"
        onSave={(data) => assign({ tagId, target: targetValue(data) })}
      >
        <TargetSelect />
      </Form>
      {assignments === undefined ? (
        <Loading />
      ) : assignments.length === 0 ? (
        <Empty>No records carry this tag yet.</Empty>
      ) : (
        assignments.map((a) => (
          <div
            key={a._id}
            className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
          >
            <span className="text-sm">
              {records?.find(
                (r) =>
                  r.target.kind === a.target.kind &&
                  r.target.id === a.target.id,
              )?.label ?? `${a.target.kind} · ${a.target.id}`}
            </span>
            <Action onClick={() => unassign({ id: a._id })}>Remove tag</Action>
          </div>
        ))
      )}
    </>
  );
}
export default function TagsPage() {
  const tags = useQuery(api.tags.list);
  const create = useMutation(api.tags.create);
  const update = useMutation(api.tags.update);
  return (
    <Page
      title="Tags"
      description="Group related records with simple tags. Projects are tags, with notes and explicitly selected records."
    >
      <Editor title="New tag">
        <Form
          label="Create tag"
          onSave={(data) => create({ name: textValue(data, "name") })}
        >
          <TextField label="Tag name" name="name" required />
        </Form>
      </Editor>
      {tags === undefined ? (
        <Loading />
      ) : tags.length === 0 ? (
        <Empty>No tags yet.</Empty>
      ) : (
        tags.map((tag) => (
          <Panel key={tag._id} title={tag.name}>
            <Editor title="Edit tag">
              <Form
                onSave={(data) =>
                  update({ id: tag._id, name: textValue(data, "name") })
                }
              >
                <TextField
                  label="Tag name"
                  name="name"
                  value={tag.name}
                  required
                />
              </Form>
            </Editor>
            <Editor title="Tagged records">
              <Assignments tagId={tag._id} />
            </Editor>
            <RecordDetails target={{ kind: "tag", id: tag._id }} />
            <Action
              confirm="Archive this tag? Existing history is retained."
              onClick={() => update({ id: tag._id, archived: true })}
            >
              Archive
            </Action>
          </Panel>
        ))
      )}
    </Page>
  );
}
