import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RouteFocus } from './core/navigation/route-focus.directive';
import { SiteHeader } from './layout/site-header/site-header';
import { SiteFooter } from './layout/site-footer/site-footer';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouteFocus, SiteHeader, SiteFooter],
  templateUrl: './app.html',
})
export class App {}
