import { Component } from '@angular/core';

@Component({
  template: `
    <section class="content-page ds-stack">
      <h1>T. rex</h1>
      <p>An orthographic study of Tyrannosaurus rex, seen directly from above.</p>
      <div class="ds-card">
        <img
          src="trex.svg"
          alt="Tyrannosaurus rex seen from above, with a broad skull, tiny arms, powerful legs and a long curved tail."
          width="420"
          height="660"
        />
      </div>
    </section>
  `,
  styles: `
    img {
      margin-inline: auto;
    }
  `,
})
export class TRexPage {}
