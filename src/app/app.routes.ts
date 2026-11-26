import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Made by Marcel | Frontend Developer',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'about',
    title: 'About | Made by Marcel',
    loadComponent: () => import('./features/about/about-page').then((m) => m.AboutPage),
  },
  {
    path: 'experience',
    title: 'Experience | Made by Marcel',
    loadComponent: () =>
      import('./features/experience/experience-page').then((m) => m.ExperiencePage),
  },
  {
    path: 'projects',
    title: 'Projects | Made by Marcel',
    loadComponent: () => import('./features/projects/projects-page').then((m) => m.ProjectsPage),
  },
  {
    path: 'projects/canoe-polo',
    title: 'Canoe polo AI | Made by Marcel',
    loadComponent: () =>
      import('./features/canoe-polo/canoe-polo-page').then((m) => m.CanoePoloPage),
  },
  {
    path: 'projects/biped',
    title: 'Biped robot | Made by Marcel',
    loadComponent: () => import('./features/biped/biped-page').then((m) => m.BipedPage),
  },
  {
    path: 'projects/t-rex',
    title: 'T. rex | Made by Marcel',
    loadComponent: () => import('./features/t-rex/t-rex-page').then((m) => m.TRexPage),
  },
  {
    path: 'lab',
    title: 'Lab | Made by Marcel',
    loadComponent: () => import('./features/lab/lab-page').then((m) => m.LabPage),
  },
  {
    path: 'contact',
    title: 'Contact | Made by Marcel',
    loadComponent: () => import('./features/contact/contact-page').then((m) => m.ContactPage),
  },
  {
    path: '404',
    title: 'Page not found | Made by Marcel',
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
  {
    path: '**',
    title: 'Page not found | Made by Marcel',
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
