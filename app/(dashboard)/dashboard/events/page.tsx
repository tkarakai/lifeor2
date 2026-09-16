"use client";
import { useMutation, useQuery } from "@/lib/dataset";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Page,
  Panel,
  Collection,
  Editor,
  Form,
  TextField,
  Action,
  Loading,
  Empty,
  textValue,
  dateValue,
  localDateTime,
} from "@/components/record-ui";
import { RecordDetails } from "@/components/record-details";
import {
  TargetSelect,
  targetValue,
  useRecordOptions,
} from "@/components/target-select";
function EventLinks({ eventId }: { eventId: Id<"event"> }) {
  const links = useQuery(api.events.getAffects, { eventId });
  const records = useRecordOptions();
  const add = useMutation(api.events.addAffects);
  return (
    <>
      <Form
        label="Link record"
        onSave={(data) =>
          add({
            eventId,
            target: targetValue(data),
            meaning: textValue(data, "meaning") || undefined,
          })
        }
      >
        <TargetSelect />
        <TextField
          label="How this record is affected (optional)"
          name="meaning"
        />
      </Form>
      {links === undefined ? (
        <Loading />
      ) : links.length === 0 ? (
        <Empty>No affected records linked.</Empty>
      ) : (
        links.map((link) => (
          <p key={link._id} className="border-t pt-3 text-sm">
            {records?.find((r) => r.target.id === link.target_id)?.label ??
              `${link.target_type} · ${link.target_id}`}
            {link.meaning && ` · ${link.meaning}`}
          </p>
        ))
      )}
    </>
  );
}
function EventForm({
  corrects,
}: {
  corrects?: {
    _id: Id<"event">;
    kind: string;
    title?: string;
    occurred_at: number;
    ended_at?: number;
  };
}) {
  const create = useMutation(api.events.create);
  return (
    <Form
      label={corrects ? "Record correction" : "Record event"}
      onSave={(data) =>
        create({
          kind: textValue(data, "kind"),
          title: textValue(data, "title"),
          occurred_at: dateValue(data, "start")!,
          ended_at: dateValue(data, "end"),
          corrects_id: corrects?._id,
          payload_json: "{}",
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Title"
          name="title"
          value={corrects?.title}
          required
        />
        <TextField
          label="Kind"
          name="kind"
          value={corrects?.kind}
          required
          hint="For example: Purchase, Vaccination, or Invoice issued."
        />
        <TextField
          label="Occurred at"
          name="start"
          type="datetime-local"
          value={localDateTime(corrects?.occurred_at)}
          required
        />
        <TextField
          label="Ended at (optional)"
          name="end"
          type="datetime-local"
          value={
            corrects?.ended_at === undefined
              ? ""
              : localDateTime(corrects.ended_at)
          }
        />
      </div>
    </Form>
  );
}
export default function EventsPage() {
  const events = useQuery(api.events.list);
  const remove = useMutation(api.events.remove);
  const voidEvent = useMutation(api.events.voidEvent);
  return (
    <Page
      title="Events"
      description="Record what actually happened. Planned and expected occurrences belong in Planning."
      actions={
        <>
          <Editor title="Record an actual event">
            <EventForm />
          </Editor>
        </>
      }
    >
      {events === undefined ? (
        <Loading />
      ) : events.length === 0 ? (
        <Empty>No actual events recorded yet.</Empty>
      ) : (
        <Collection label="events">
          {events.map((event) => (
            <Panel
              key={event._id}
              category={event.voided_at !== undefined ? "Voided" : event.kind}
              title={event.title || event.kind}
              context={
                event.void_reason
                  ? `Void reason: ${event.void_reason}`
                  : event.ended_at !== undefined
                    ? `Ended ${new Date(event.ended_at).toLocaleString()}`
                    : undefined
              }
              description={`${event.kind} · ${new Date(event.occurred_at).toLocaleString()}${event.corrects_id ? " · Correction" : ""}`}
            >
              <Editor title="Affected records">
                <EventLinks eventId={event._id} />
              </Editor>
              <RecordDetails target={{ kind: "event", id: event._id }} />
              {event.voided_at !== undefined ? (
                <p className="text-sm text-muted-foreground">
                  Voided: {event.void_reason}
                </p>
              ) : (
                <>
                  <Editor title="Void event">
                    <Form
                      label="Void event"
                      onSave={(data) =>
                        voidEvent({
                          id: event._id,
                          reason: textValue(data, "reason"),
                        })
                      }
                    >
                      <p className="text-sm text-muted-foreground">
                        Voiding retains history. Financial events with posted
                        journals require a journal correction.
                      </p>
                      <TextField label="Reason" name="reason" required />
                    </Form>
                  </Editor>
                  <Editor title="Correct this event">
                    <p className="text-sm text-muted-foreground">
                      Creates a new occurrence linked to this record, retaining
                      the original.
                    </p>
                    <EventForm corrects={event} />
                  </Editor>
                </>
              )}
              {event.payload_json !== "{}" && (
                <Editor title="Preserved source payload">
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
                    {event.payload_json}
                  </pre>
                </Editor>
              )}
              <Action
                confirm="Archive this event? Financial records and occurrence history are retained."
                onClick={() => remove({ id: event._id })}
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
