import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Resolve route files relative to this module so docs work whatever the cwd is
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Music Room API',
      version: '1.0.0',
      description: 'Documentation officielle de l\'API Music Room (Auth, Playlists, Salles, Deezer)',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Serveur Local',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      { bearerAuth: [] },
    ],
  },
  apis: [join(srcDir, 'routes/*.js'), join(srcDir, 'app.js')],
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}
