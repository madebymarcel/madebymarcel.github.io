import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  imports: [RouterLink],
  template: `
    <section class="content-page">
      <h1>Page not found</h1>
      <a routerLink="/">Return home</a>
    </section>
  `,
})
export class NotFoundPage {}
