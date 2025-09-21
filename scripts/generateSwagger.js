const swaggerJSDoc = require('swagger-jsdoc');
const fs = require('fs');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FixMyCity API',
      version: '1.0.0',
    },
  },
  apis: [
    path.join(__dirname, '../routes/*.js')
  ],
};

const swaggerSpec = swaggerJSDoc(options);

fs.writeFileSync(
  path.join(__dirname, '../swagger.json'),
  JSON.stringify(swaggerSpec, null, 2)
);

console.log('swagger.json generated!');
