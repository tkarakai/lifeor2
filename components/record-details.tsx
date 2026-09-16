"use client";
import {
  DetailsEditor,
  type DetailsEditorProps,
} from "@/components/details-editor";
import { Editor } from "@/components/record-ui";
export function RecordDetails(props: DetailsEditorProps) {
  return (
    <Editor title="Details & history">
      <DetailsEditor {...props} />
    </Editor>
  );
}
