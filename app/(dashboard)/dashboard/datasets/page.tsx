"use client";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useDataset } from "@/lib/dataset";
import {
  Page,
  Panel,
  Action,
  Form,
  TextField,
  textValue,
} from "@/components/record-ui";
import { SAMPLE_AS_OF } from "@/lib/family-fixture";
export default function DatasetsPage() {
  const { id, datasets } = useDataset();
  const create = useMutation(api.datasets.create),
    select = useMutation(api.datasets.select),
    prepare = useMutation(api.sampleData.prepare),
    populate = useMutation(api.sampleData.populateMonth);
  const [progress, setProgress] = useState("");
  return (
    <Page
      title="Datasets"
      description="Keep Live and test records separate in the same database. Each dataset has its own entities, arrangements, transactions, tags and documents."
    >
      <Panel
        title="Your datasets"
        description="Datasets belong to the account shown in the sidebar. Signing in with a different email opens a separate set of datasets."
      >
        <ul className="divide-y">
          {datasets.map((d) => (
            <li
              key={d._id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="font-medium">
                  {d.name}
                  {d._id === id ? " · Current" : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {d.kind === "live"
                    ? "Live records"
                    : d.seed_as_of
                      ? `Fictional Morgan family · as of ${d.seed_as_of}`
                      : "Empty test dataset"}
                  {d.seed_status === "building"
                    ? " · Preparation incomplete; resume below"
                    : ""}
                </p>
              </div>
              {d._id !== id && d.seed_status !== "building" && (
                <Action
                  confirm="Switch datasets? Unsaved form changes will be discarded."
                  onClick={() => select({ id: d._id })}
                >
                  Switch to {d.name}
                </Action>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title="Create an empty test dataset"
        description="Start a separate workspace for your own experiments."
      >
        <Form
          label="Create dataset"
          onSave={async (d) => {
            await create({ name: textValue(d, "name") });
          }}
        >
          <TextField label="Dataset name" name="name" required />
        </Form>
      </Panel>
      <Panel
        title="Morgan family sample"
        description={`Fictional USD records through ${SAMPLE_AS_OF}. Creates test-data1, or resumes the existing family sample without duplicating transactions.`}
      >
        <p className="text-sm">
          Four family members, two rentals, a home remodel, three mortgages,
          three cars, an auto loan, two credit cards, four checking accounts and
          two LLCs. Includes January–September transactions, partial payments,
          fixed loan terms and Git-backed notes.
        </p>
        <Action
          onClick={async () => {
            setProgress("Creating accounts and relationships…");
            try {
              const datasetId = await prepare({});
              for (let monthIndex = 0; monthIndex < 9; monthIndex++) {
                setProgress(`Preparing month ${monthIndex + 1} of 9…`);
                await populate({ datasetId, monthIndex });
              }
              setProgress("Writing sample notes to Git…");
              const response = await fetch("/api/datasets/sample-documents", {
                method: "POST",
                headers: { "x-lifeor-dataset": datasetId },
              });
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  `Financial data is ready. Notes need a retry: ${result.error ?? "Git unavailable"}`,
                );
              setProgress(
                "Sample is ready. Use the dataset switcher above or in the sidebar to explore it.",
              );
            } catch (error) {
              setProgress("");
              throw error;
            }
          }}
        >
          Prepare / resume family sample
        </Action>
        {progress && (
          <p role="status" className="text-sm">
            {progress}
          </p>
        )}
      </Panel>
    </Page>
  );
}
