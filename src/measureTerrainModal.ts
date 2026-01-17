import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import type { TerrainDef } from "./map";

export interface MeasureTerrainSegment {
  label: string;
  terrainId: string;
}

export class MeasureTerrainModal extends Modal {
  private terrains: TerrainDef[];
  private segments: MeasureTerrainSegment[];
  private onSave: (segments: MeasureTerrainSegment[]) => void;

  constructor(
    app: App,
    terrains: TerrainDef[],
    segments: MeasureTerrainSegment[],
    onSave: (segments: MeasureTerrainSegment[]) => void,
  ) {
    super(app);
    this.terrains = terrains;
    this.segments = segments;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Measure terrains" });

    this.segments.forEach((seg, idx) => {
      new Setting(contentEl)
        .setName(`Segment ${idx + 1}`)
        .setDesc(seg.label)
        .addDropdown((d) => {
          for (const t of this.terrains) {
            d.addOption(t.id, `${t.name} (${t.factor}×)`);
          }
          d.setValue(seg.terrainId);
          d.onChange((v) => {
            seg.terrainId = v;
          });
        });
    });

    const footer = contentEl.createDiv({ cls: "zoommap-modal-footer" });
    const saveBtn = footer.createEl("button", { text: "Save" });
    const cancelBtn = footer.createEl("button", { text: "Cancel" });

    saveBtn.onclick = () => {
      this.close();
      this.onSave(this.segments);
    };
    cancelBtn.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}