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
      <article class="ds-card ds-stack">
        <h2>Biped robot</h2>
        <p>Train a two-legged robot to walk using joint motors and foot sensors.</p>
        <a class="ds-button" routerLink="/projects/biped">Explore biped robot</a>
      </article>
      <article class="ds-card ds-stack">
        <h2>T. rex V3</h2>
        <p>Explore the articulated dinosaur, physics, muscles and sensory receptors.</p>
        <a class="ds-button" routerLink="/projects/t-rex-v3">Explore T. rex V3</a>
      </article>
    </section>
  `,
})
export class ProjectsPage {}
