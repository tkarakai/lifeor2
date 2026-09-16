"use client";
import { useQuery, useMutation } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import {
  Page,
  Panel,
  Collection,
  Action,
  Empty,
  Loading,
  Form,
  TextField,
  textValue,
  Editor,
} from "@/components/record-ui";
import type { RecordTarget } from "@/components/target-select";
function DeleteReview({ target }: { target: RecordTarget }) {
  const review = useQuery(api.trash.inspect, { target });
  const remove = useMutation(api.trash.permanentlyDelete);
  if (!review) return <Loading />;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Permanent deletion removes this record and {review.recordCount - 1}{" "}
        attached history or metadata records. Historical Git commits remain in
        the content repository.
      </p>
      {review.blockers.length ? (
        <div>
          <p className="font-medium">Delete is blocked by these references:</p>
          <ul className="mt-2 space-y-2 text-sm">
            {review.blockers.map((b, i) => (
              <li key={i}>
                {b.kind}: {b.name} — {b.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Form
          label="Permanently delete"
          onSave={(d) =>
            remove({ target, confirmation: textValue(d, "confirmation") })
          }
        >
          <TextField
            label="Type DELETE to confirm"
            name="confirmation"
            required
          />
        </Form>
      )}
    </div>
  );
}
export default function TrashPage() {
  const rows = useQuery(api.trash.list, {}),
    restore = useMutation(api.trash.restore);
  return (
    <Page
      title="Trash"
      description="Restore archived records or permanently delete unused ones. Referenced records and posted accounting history remain protected."
    >
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No archived records in this dataset.</Empty>
      ) : (
        <Collection label="archived records">
          {rows.map((r) => (
            <Panel
              key={r.target.id}
              title={r.name}
              category={r.target.kind.replaceAll("_", " ")}
              description={r.target.kind.replaceAll("_", " ")}
            >
              <Action
                onClick={() => restore({ target: r.target as RecordTarget })}
              >
                Restore
              </Action>
              <Editor title="Review permanent deletion">
                <DeleteReview target={r.target as RecordTarget} />
              </Editor>
            </Panel>
          ))}
        </Collection>
      )}
    </Page>
  );
}
