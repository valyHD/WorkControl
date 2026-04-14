import type { ChangeEvent } from "react";

type Props = {
  selectedFiles: File[];
  onFilesChange: (files: File[]) => void;
};

export default function VehicleImageUploader({ selectedFiles, onFilesChange }: Props) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    onFilesChange(files);
  }

  return (
    <div className="tool-form-block">
      <label className="tool-form-label">Poze masina</label>

      <input type="file" multiple accept="image/*" onChange={handleChange} />

      {selectedFiles.length > 0 && (
        <div className="tool-selected-files">
          {selectedFiles.map((file) => (
            <div key={`${file.name}-${file.size}`} className="tool-selected-file">
              {file.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}