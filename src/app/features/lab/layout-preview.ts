import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { LayoutNode, LayoutPattern } from './layout-patterns';

function composition(node: LayoutNode, depth = 0): string {
  const indent = '  '.repeat(depth);
  if (node.kind === 'tile') {
    return `${indent}<div class="ds-card">${node.title}</div>`;
  }

  const children = node.children.map((child) => composition(child, depth + 2)).join('\n');
  return [
    `${indent}<div class="ds-layout-context">`,
    `${indent}  <div class="${node.layout}">`,
    children,
    `${indent}  </div>`,
    `${indent}</div>`,
  ].join('\n');
}

@Component({
  selector: 'app-layout-preview',
  imports: [NgTemplateOutlet],
  templateUrl: './layout-preview.html',
  styleUrl: './layout-preview.scss',
})
export class LayoutPreview {
  readonly pattern = input.required<LayoutPattern>();
  readonly markup = computed(() => composition(this.pattern().root));
  readonly chart = [28, 47, 38, 72, 58, 90];
}
