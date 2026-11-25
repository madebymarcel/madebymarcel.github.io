import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  template: `
    <section class="content-page ds-stack">
      <h1>Projects</h1>
      <article class="ds-card ds-stack">
        <h2>Canoe polo AI</h2>
        <p>Watch artificial athletes learn a sport through reinforcement learning and self-play.</p>
        <a class="ds-button" routerLink="/projects/canoe-polo">Explore canoe polo</a>
      </article>
    </section>
  `,
})
export class ProjectsPage {}
