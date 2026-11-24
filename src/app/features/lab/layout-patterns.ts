export interface LayoutTile {
  kind: 'tile';
  title: string;
  description: string;
  appearance: 'text' | 'media' | 'portrait' | 'hero' | 'metric' | 'list' | 'chart';
  items: readonly string[];
}

export interface LayoutGroup {
  kind: 'group';
  layout: string;
  children: readonly LayoutNode[];
}

export type LayoutNode = LayoutTile | LayoutGroup;

export interface LayoutPattern {
  id: string;
  name: string;
  description: string;
  responsive: string;
  root: LayoutNode;
}

interface LayoutCategory {
  title: string;
  patterns: readonly LayoutPattern[];
}

function tile(
  title: string,
  description: string,
  appearance: LayoutTile['appearance'] = 'text',
  items: readonly string[] = [],
): LayoutTile {
  return { kind: 'tile', title, description, appearance, items };
}

function group(layout: string, children: readonly LayoutNode[]): LayoutGroup {
  return { kind: 'group', layout, children };
}

export const LAYOUT_CATEGORIES: readonly LayoutCategory[] = [
  {
    title: 'Editorial and storytelling',
    patterns: [
      {
        id: 'editorial',
        name: 'Editorial layout',
        description: 'A feature image and a considered reading column.',
        responsive: 'The story and its image stack in reading order.',
        root: group('ds-stack', [
          group('ds-golden-split', [
            tile('The shape of water', 'An exploration of light and motion.', 'media'),
            tile(
              'A slower kind of interface',
              'A digital space that invites the reader to explore.',
            ),
          ]),
          group('ds-grid', [
            tile('01 · Process', 'Observe, prototype and refine.'),
            tile('02 · Outcome', 'Build for the space available.'),
          ]),
        ]),
      },
      {
        id: 'magazine',
        name: 'Magazine',
        description: 'A prominent feature surrounded by smaller stories.',
        responsive: 'The feature stays first; the story grid adapts.',
        root: group('ds-stack', [
          tile('The weekend edition', 'Design, technology and creative practice.'),
          group('ds-golden-split', [
            tile('Cover story', 'Finding rhythm in everyday interfaces.', 'media'),
            group('ds-stack', [
              tile('Field notes', 'A study in texture.', 'media'),
              tile('In conversation', 'Designing for people.'),
            ]),
          ]),
          group('ds-grid', [
            tile('Culture', 'Small details matter.', 'media'),
            tile('Studio', 'A new perspective.', 'media'),
            tile('Ideas', 'The next experiment.', 'media'),
          ]),
        ]),
      },
      {
        id: 'long-form',
        name: 'Long-form article',
        description: 'A restrained reading measure interrupted by a broad visual.',
        responsive: 'The reading column fills the space without losing its measure.',
        root: group('ds-stack', [
          group('ds-center', [
            tile(
              'An intentional web',
              'A long-form essay about simplicity, movement and accessibility.',
            ),
          ]),
          group('ds-center', [
            tile(
              'Begin with the content',
              'Typography and whitespace make the story easier to follow.',
            ),
          ]),
          group('ds-bleed', [
            tile(
              'A moment to breathe',
              'A wide illustration breaks the rhythm of the article.',
              'media',
            ),
          ]),
          group('ds-center', [
            tile(
              'Return to the story',
              'A consistent reading measure brings attention back to the words.',
            ),
          ]),
        ]),
      },
      {
        id: 'case-study',
        name: 'Case study',
        description: 'A project narrative with an introduction, evidence and outcome.',
        responsive: 'The narrative stays in its natural order; metrics wrap.',
        root: group('ds-stack', [
          group('ds-golden-split', [
            tile('A better portfolio', 'Design and engineering for a more expressive web.'),
            tile('The finished experience', 'Responsive, accessible and playful.', 'media'),
          ]),
          group('ds-grid', [
            tile('96', 'Performance score', 'metric'),
            tile('100', 'Accessibility score', 'metric'),
            tile('3', 'Browsers tested', 'metric'),
          ]),
          group('ds-golden-split', [
            tile('Process', 'Prototypes and iterations.', 'media'),
            tile('Outcome', 'A shared system for future experiments.'),
          ]),
        ]),
      },
      {
        id: 'timeline',
        name: 'Timeline',
        description: 'A chronological sequence of milestones.',
        responsive: 'Alternating milestones become a single-sided timeline.',
        root: group('ds-timeline', [
          tile('2019 · First prototype', 'A radial navigation experiment.'),
          tile('2022 · Building experience', 'Reusable frontend architecture.'),
          tile('2026 · Design system', 'Mathematical and accessible foundations.'),
          tile('Next · Exploration', 'More creative web experiences.'),
        ]),
      },
      {
        id: 'comparison',
        name: 'Comparison',
        description: 'Two approaches with corresponding characteristics grouped together.',
        responsive: 'Each pair stacks together, preserving the comparison.',
        root: group('ds-stack', [
          group('ds-equal-split', [
            tile('Approach A', 'A restrained composition.', 'media'),
            tile('Approach B', 'A more expressive composition.', 'media'),
          ]),
          group('ds-equal-split', [
            tile('Typography · A', 'Compact modular scale.'),
            tile('Typography · B', 'Larger display scale.'),
          ]),
          group('ds-equal-split', [
            tile('Motion · A', 'Subtle transitions.'),
            tile('Motion · B', 'Expressive visual feedback.'),
          ]),
        ]),
      },
    ],
  },
  {
    title: 'Creative and visual',
    patterns: [
      {
        id: 'bento',
        name: 'Bento layout',
        description: 'A featured tile and smaller complementary modules.',
        responsive: 'Spanning tiles become a single-column composition when needed.',
        root: group('ds-bento', [
          tile('Featured experiment', 'An immersive water study.', 'media'),
          tile('1.618', 'Golden ratio', 'metric'),
          tile('Accessibility', 'Inclusive by design.'),
          tile('Motion', 'Small moments of delight.', 'media'),
          tile('Next up', 'Explore a new composition.'),
        ]),
      },
      {
        id: 'landing',
        name: 'Landing page',
        description: 'A welcoming hero followed by a collection of benefits.',
        responsive: 'The hero keeps its hierarchy and benefits wrap naturally.',
        root: group('ds-stack', [
          group('ds-bleed', [
            tile('Made for the web', 'Thoughtful design. Creative engineering.', 'hero'),
          ]),
          group('ds-grid', [
            tile('Accessible', 'Built for people.'),
            tile('Responsive', 'Designed for every space.'),
            tile('Expressive', 'Room to experiment.'),
          ]),
          tile('Start exploring', 'Discover the work, the process and the ideas behind it.'),
        ]),
      },
      {
        id: 'immersive',
        name: 'Creative immersive layout',
        description: 'A large visual stage with a layered editorial caption.',
        responsive: 'Text returns to normal flow in constrained spaces.',
        root: group('ds-stack', [
          group('ds-layer', [
            tile('An immersive world', 'A visual stage for creative experiments.', 'hero'),
            tile(
              'Light, depth and motion',
              'An invitation to explore a different kind of web experience.',
            ),
          ]),
          group('ds-grid', [
            tile('Interaction', 'Responds to the visitor.'),
            tile('Atmosphere', 'Colour, light and texture.'),
          ]),
        ]),
      },
      {
        id: 'masonry',
        name: 'Masonry',
        description: 'Independent columns with varied visual heights.',
        responsive: 'Columns stack without changing the document reading order.',
        root: group('ds-masonry', [
          group('ds-stack', [
            tile('Tidal forms', 'A study in curves.', 'media'),
            tile('Slow gradients', 'Light across a surface.', 'portrait'),
          ]),
          group('ds-stack', [
            tile('Vertical study', 'A different aspect ratio.', 'portrait'),
            tile('Quiet spaces', 'An abstract composition.', 'media'),
          ]),
          group('ds-stack', [
            tile('Reflections', 'A soft transition.', 'media'),
            tile('Geometry', 'A taller composition.', 'portrait'),
          ]),
        ]),
      },
      {
        id: 'split-screen',
        name: 'Split screen',
        description: 'Two complementary panels of equal visual weight.',
        responsive: 'The two panels stack without losing their identity.',
        root: group('ds-equal-split', [
          tile('Design', 'Structure, rhythm and meaning.', 'hero'),
          tile('Engineering', 'Interaction, motion and performance.', 'portrait'),
        ]),
      },
      {
        id: 'zigzag',
        name: 'Zigzag',
        description: 'Alternating visual and text compositions.',
        responsive: 'Each associated pair stacks in document order.',
        root: group('ds-stack', [
          group('ds-golden-split', [
            tile('Observe', 'Discover the problem.', 'media'),
            tile('01 · Explore', 'Listen, understand and identify possibilities.'),
          ]),
          group('ds-golden-split', [
            tile('02 · Create', 'Prototype the interaction and test the idea.'),
            tile('Experiment', 'Make the concept tangible.', 'media'),
          ]),
          group('ds-golden-split', [
            tile('Refine', 'Polish the details.', 'media'),
            tile('03 · Deliver', 'Verify the experience across devices.'),
          ]),
        ]),
      },
      {
        id: 'layered',
        name: 'Layered composition',
        description: 'Overlapping panels create depth without obscuring essential content.',
        responsive: 'The overlay returns to ordinary document flow.',
        root: group('ds-stack', [
          group('ds-layer', [
            tile('An abstract landscape', 'A decorative visual surface.', 'hero'),
            tile('A second layer', 'A distinct card overlaps the edge of the visual.'),
          ]),
          tile('A note on depth', 'Layering is optional; legibility takes precedence.'),
        ]),
      },
      {
        id: 'scrollytelling',
        name: 'Scrollytelling',
        description: 'A persistent visual beside a sequence of narrative steps.',
        responsive: 'The visual becomes the first item of a linear narrative.',
        root: group('ds-sticky-split', [
          tile('Persistent visual', 'The illustration remains in view beside the story.', 'media'),
          group('ds-stack', [
            tile('01 · Discover', 'Begin with the question and explore the context.'),
            tile('02 · Experiment', 'Try different forms, colours and interactions.'),
            tile('03 · Evaluate', 'Look for clarity, performance and accessibility.'),
            tile('04 · Refine', 'Keep what works and simplify what does not.'),
            tile('05 · Share', 'Explain the decisions behind the result.'),
          ]),
        ]),
      },
    ],
  },
  {
    title: 'Content discovery and products',
    patterns: [
      {
        id: 'product-gallery',
        name: 'Product gallery',
        description: 'An adaptive grid of product or project cards.',
        responsive: 'Cards automatically wrap to fewer columns.',
        root: group('ds-stack', [
          tile('Selected work', 'A collection of visual explorations.'),
          group('ds-grid', [
            tile('Water', 'Shader experiment.', 'media'),
            tile('Forest', 'Parallax study.', 'media'),
            tile('Orbit', 'Radial navigation.', 'media'),
            tile('Form', 'Geometric composition.', 'media'),
            tile('Light', 'Lighting study.', 'media'),
            tile('Motion', 'Animation experiment.', 'media'),
          ]),
        ]),
      },
      {
        id: 'filtered-catalogue',
        name: 'Filtered catalogue',
        description: 'A filter column next to a responsive collection.',
        responsive: 'The filter summary appears above the items.',
        root: group('ds-sidebar', [
          tile('Filters', '', 'list', ['All projects', 'WebGL', 'Animation', 'Design systems']),
          group('ds-stack', [
            tile('Browse projects', 'Six example results · newest first'),
            group('ds-grid', [
              tile('Tide', 'WebGL', 'media'),
              tile('Orbit', 'Animation', 'media'),
              tile('Rhythm', 'Design system', 'media'),
              tile('Light', 'WebGL', 'media'),
            ]),
          ]),
        ]),
      },
      {
        id: 'product-detail',
        name: 'Product detail',
        description: 'A prominent product image, thumbnails and supporting information.',
        responsive: 'Media and related details stack in a logical sequence.',
        root: group('ds-golden-split', [
          group('ds-stack', [
            tile('The Arc collection', 'A study in geometric forms.', 'media'),
            group('ds-reel', [
              tile('Detail 01', '', 'media'),
              tile('Detail 02', '', 'media'),
              tile('Detail 03', '', 'media'),
            ]),
          ]),
          group('ds-stack', [
            tile('Arc · No. 01', 'A carefully proportioned object.'),
            tile('€89', 'Illustrative price', 'metric'),
            tile('Specifications', '', 'list', [
              'Satin finish',
              'Recycled material',
              'Made to last',
            ]),
          ]),
        ]),
      },
      {
        id: 'search-results',
        name: 'Search results',
        description: 'Result summaries alongside an optional contextual preview.',
        responsive: 'The preview follows the results on narrow screens.',
        root: group('ds-stack', [
          tile('Search · design', 'Three matching example results.'),
          group('ds-sidebar-end', [
            group('ds-stack', [
              tile('Design tokens', 'A shared visual vocabulary.'),
              tile('Fluid layout', 'Responsive spacing and composition.'),
              tile('Accessibility', 'Inclusive interaction patterns.'),
            ]),
            tile('Result preview', 'A detail view of the selected result.', 'media'),
          ]),
        ]),
      },
      {
        id: 'master-detail',
        name: 'Master-detail',
        description: 'A collection list and a related detail panel.',
        responsive: 'List and detail stack while maintaining their order.',
        root: group('ds-sidebar', [
          tile('Projects', '', 'list', [
            'Water study · selected',
            'Motion study',
            'Colour study',
            'Typography',
          ]),
          group('ds-stack', [
            tile('Water study', 'Explore the surface of water.', 'media'),
            tile('Details', 'A real-time shader and a responsive canvas.'),
          ]),
        ]),
      },
      {
        id: 'showcase-gallery',
        name: 'Showcase gallery',
        description: 'A large featured visual with an independently scrollable thumbnail strip.',
        responsive: 'The main visual stays prominent; thumbnails remain in a local reel.',
        root: group('ds-stack', [
          tile('A collection of visual studies', 'Featured visual · abstract forms.', 'hero'),
          group('ds-reel', [
            tile('01 · Tide', '', 'media'),
            tile('02 · Arc', '', 'media'),
            tile('03 · Forest', '', 'media'),
            tile('04 · Orbit', '', 'media'),
            tile('05 · Light', '', 'media'),
          ]),
        ]),
      },
    ],
  },
  {
    title: 'Applications and functional',
    patterns: [
      {
        id: 'dashboard',
        name: 'Application dashboard',
        description: 'A navigation area, summary metrics and an activity overview.',
        responsive: 'The navigation and content stack; metrics wrap.',
        root: group('ds-sidebar', [
          tile('Workspace', '', 'list', ['Overview', 'Reports', 'Activity', 'Settings']),
          group('ds-stack', [
            tile('Overview', 'Illustrative dashboard data.'),
            group('ds-grid', [
              tile('12', 'Projects', 'metric'),
              tile('96%', 'Quality score', 'metric'),
              tile('5', 'Experiments', 'metric'),
            ]),
            tile('Activity', 'Example activity across six periods.', 'chart'),
            tile('Recent activity', '', 'list', [
              'Design tokens updated',
              'Layout patterns added',
              'Quality checks completed',
            ]),
          ]),
        ]),
      },
      {
        id: 'three-pane',
        name: 'Three-pane workspace',
        description: 'Navigation, primary workspace and contextual inspector.',
        responsive: 'The panels stack in reading order when space is limited.',
        root: group('ds-workspace', [
          tile('Navigation', '', 'list', ['Files', 'Components', 'Assets']),
          tile('Workspace', 'The main editing surface.', 'hero'),
          tile('Inspector', '', 'list', ['Properties', 'Spacing', 'Typography', 'Layers']),
        ]),
      },
      {
        id: 'kanban',
        name: 'Kanban board',
        description: 'Work grouped into status columns.',
        responsive: 'Columns become vertical groups without hiding tasks.',
        root: group('ds-masonry', [
          group('ds-stack', [
            tile('To do', '2 tasks'),
            tile('Design tokens', 'Review palette.'),
            tile('Layout catalogue', 'Plan compositions.'),
          ]),
          group('ds-stack', [
            tile('In progress', '2 tasks'),
            tile('Responsive layout', 'Refine patterns.'),
            tile('Documentation', 'Write usage examples.'),
          ]),
          group('ds-stack', [
            tile('Done', '2 tasks'),
            tile('Theme support', 'Light and dark.'),
            tile('Spacing', 'Fibonacci scale.'),
          ]),
        ]),
      },
      {
        id: 'settings',
        name: 'Settings',
        description: 'Category navigation beside grouped configuration summaries.',
        responsive: 'Categories sit above settings in document order.',
        root: group('ds-sidebar', [
          tile('Settings', '', 'list', ['Appearance', 'Accessibility', 'Notifications']),
          group('ds-stack', [
            tile('Appearance', '', 'list', ['Theme · System', 'Density · Comfortable']),
            tile('Accessibility', '', 'list', ['Reduced motion · System', 'Text size · Default']),
            tile('Notifications', '', 'list', ['Email · Disabled', 'Updates · Enabled']),
          ]),
        ]),
      },
      {
        id: 'wizard',
        name: 'Wizard',
        description: 'A focused step-by-step process with a visible progress summary.',
        responsive: 'The current step retains a readable measure.',
        root: group('ds-stack', [
          group('ds-grid', [
            tile('01 · Details', 'Complete'),
            tile('02 · Preferences', 'Current step'),
            tile('03 · Review', 'Upcoming'),
          ]),
          group('ds-center', [
            tile('Preferences', '', 'list', [
              'Choose a theme',
              'Choose a comfortable density',
              'Review accessibility preferences',
            ]),
          ]),
          group('ds-center', [
            tile('Next · Review', 'Illustrative step navigation.'),
          ]),
        ]),
      },
      {
        id: 'canvas',
        name: 'Canvas workspace',
        description: 'A central canvas with contextual tool and inspector panels.',
        responsive: 'The canvas and panels stack while preserving their context.',
        root: group('ds-stack', [
          tile('Creative workspace', 'An illustrative editing environment.'),
          group('ds-workspace', [
            tile('Tools', '', 'list', ['Select', 'Move', 'Rotate']),
            tile('Canvas', 'A central visual editing surface.', 'hero'),
            tile('Inspector', '', 'list', ['Position', 'Rotation', 'Scale']),
          ]),
          tile('Status', '', 'list', ['Document saved', 'Preview mode']),
        ]),
      },
    ],
  },
];
