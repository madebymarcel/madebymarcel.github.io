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
        <h2>T. rex</h2>
        <p>A top-down study of dinosaur anatomy using scalable vector shapes.</p>
        <a class="ds-button" routerLink="/projects/t-rex">Explore T. rex</a>
      </article>
      <article class="ds-card ds-stack">
        <h2>T. rex V2</h2>
        <p>Experimental continuous feedback learning, with planar and full 3D training.</p>
        <a class="ds-button" routerLink="/projects/t-rex-v2">Explore T. rex V2</a>
      </article>
    </section>
  `,
})
export class ProjectsPage {}
