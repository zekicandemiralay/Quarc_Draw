// Tool factory.

import type { Editor } from '../editor/editor';
import type { Tool } from './tool';
import { BrushTool } from './brushTool';
import { MarqueeTool, LassoTool, WandTool, SelectBrushTool } from './selectTools';
import { HandTool, ZoomTool, RotateViewTool } from './viewTools';
import { EyedropperTool, BucketTool, GradientTool } from './paintTools';
import { MoveTool, TransformTool } from './moveTools';
import { ShapeTool, FreeformTool, PenTool } from './shapeTools';
import { NodeTool } from './nodeTool';
import { TextTool } from './textTool';
import { CropTool } from './cropTool';
import { ImageTool, MeasureTool } from './utilityTools';
import { toolMeta } from './catalog';

export function createTool(id: string, ed: Editor): Tool {
  const name = toolMeta(id)?.name ?? id;
  switch (id) {
    case 'brush': case 'eraser': case 'smudge': case 'blur': case 'sharpen': case 'dodge': case 'burn': case 'clone':
      return new BrushTool(ed, id, name);
    case 'marquee-rect': case 'marquee-ellipse': return new MarqueeTool(ed, id, name);
    case 'lasso': case 'lasso-poly': return new LassoTool(ed, id, name);
    case 'wand': return new WandTool(ed);
    case 'select-brush': return new SelectBrushTool(ed);
    case 'hand': return new HandTool(ed);
    case 'zoom': return new ZoomTool(ed);
    case 'rotate-view': return new RotateViewTool(ed);
    case 'eyedropper': return new EyedropperTool(ed);
    case 'bucket': return new BucketTool(ed);
    case 'gradient': return new GradientTool(ed);
    case 'move': return new MoveTool(ed);
    case 'transform': return new TransformTool(ed);
    case 'rect': case 'ellipse': case 'polygon': case 'star': case 'line': case 'arrow': return new ShapeTool(ed, id, name, id);
    case 'freeform': return new FreeformTool(ed);
    case 'pen': return new PenTool(ed);
    case 'node': return new NodeTool(ed);
    case 'text': return new TextTool(ed);
    case 'crop': return new CropTool(ed);
    case 'image': return new ImageTool(ed);
    case 'measure': return new MeasureTool(ed);
    default: return new HandTool(ed);
  }
}
