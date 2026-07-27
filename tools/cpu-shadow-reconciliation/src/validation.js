import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export function createValidator(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return (value) => {
    const valid = validate(value);
    return {
      valid,
      errors: valid
        ? []
        : validate.errors.map((error) => ({
            instancePath: error.instancePath,
            keyword: error.keyword,
            message: error.message,
            params: error.params,
          })),
    };
  };
}
