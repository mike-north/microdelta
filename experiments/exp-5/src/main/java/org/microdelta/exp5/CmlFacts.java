package org.microdelta.exp5;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.contextmapper.dsl.cml.CMLResource;
import org.contextmapper.dsl.contextMappingDSL.Aggregate;
import org.contextmapper.dsl.contextMappingDSL.BoundedContext;
import org.contextmapper.dsl.standalone.ContextMapperStandaloneSetup;
import org.contextmapper.tactic.dsl.tacticdsl.ComplexType;
import org.contextmapper.tactic.dsl.tacticdsl.DomainObject;
import org.contextmapper.tactic.dsl.tacticdsl.DomainObjectOperation;
import org.contextmapper.tactic.dsl.tacticdsl.Parameter;
import org.contextmapper.tactic.dsl.tacticdsl.Service;
import org.contextmapper.tactic.dsl.tacticdsl.ServiceOperation;
import org.contextmapper.tactic.dsl.tacticdsl.SimpleDomainObject;
import org.contextmapper.tactic.dsl.tacticdsl.Visibility;

/** Extracts a deliberately small native CML fact set without parsing CML syntax ourselves. */
public final class CmlFacts {
  /** This utility has no instance state or runtime role outside the experiment. */
  private CmlFacts() {}

  /** Parse one CML model and write deterministic facts for the TypeScript checker. */
  public static void main(String[] args) throws IOException {
    if (args.length != 2) {
      throw new IllegalArgumentException("Expected CML input and JSON output paths");
    }
    CMLResource resource = ContextMapperStandaloneSetup.getStandaloneAPI().loadCML(args[0]);
    if (!resource.getErrors().isEmpty() || resource.getContextMappingModel() == null) {
      throw new IllegalStateException("CML parser rejected model: " + resource.getErrors());
    }
    List<Object> contexts = new ArrayList<>();
    for (BoundedContext context : resource.getContextMappingModel().getBoundedContexts()) {
      List<Object> aggregates = new ArrayList<>();
      for (Aggregate aggregate : context.getAggregates()) {
        List<Object> objects = new ArrayList<>();
        for (SimpleDomainObject object : aggregate.getDomainObjects()) {
          if (object instanceof DomainObject) {
            List<Object> operations = new ArrayList<>();
            for (DomainObjectOperation operation : ((DomainObject) object).getOperations()) {
              operations.add(operation(operation.getName(), operation.getVisibility(), operation.getReturnType(), operation.getParameters()));
            }
            objects.add(fields("name", object.getName(), "kind", "Entity", "operations", operations));
          }
        }
        for (Service service : aggregate.getServices()) {
          List<Object> operations = new ArrayList<>();
          for (ServiceOperation operation : service.getOperations()) {
            operations.add(operation(operation.getName(), operation.getVisibility(), operation.getReturnType(), operation.getParameters()));
          }
          objects.add(fields("name", service.getName(), "kind", "Service", "operations", operations));
        }
        aggregates.add(fields("name", aggregate.getName(), "objects", objects));
      }
      contexts.add(fields("name", context.getName(), "aggregates", aggregates));
    }
    Files.writeString(Path.of(args[1]), json(fields("contexts", contexts)), StandardCharsets.UTF_8);
  }

  /** A type reference keeps its declared object name; simple scalars keep CML spelling. */
  private static String type(ComplexType value) {
    if (value == null) {
      throw new IllegalStateException("Mapped operation has no return/parameter type");
    }
    if (value.getDomainObjectType() != null) {
      return value.getDomainObjectType().getName();
    }
    if (value.getType() == null) {
      throw new IllegalStateException("Unsupported complex CML type");
    }
    return value.getType();
  }

  /** Operation extraction retains parameter order and semantic visibility. */
  private static Map<String, Object> operation(String name, Visibility visibility, ComplexType returnType, List<Parameter> parameters) {
    List<Object> inputs = new ArrayList<>();
    for (Parameter parameter : parameters) {
      inputs.add(fields("name", parameter.getName(), "type", type(parameter.getParameterType())));
    }
    return fields("name", name, "visibility", visibility.toString(), "returnType", type(returnType), "parameters", inputs);
  }

  /** Insertion-ordered object facts make generated evidence diffable. */
  private static Map<String, Object> fields(Object... pairs) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (int index = 0; index < pairs.length; index += 2) {
      result.put((String) pairs[index], pairs[index + 1]);
    }
    return result;
  }

  /** JSON encoding is limited to extracted strings, maps and lists; it is not a CML parser. */
  private static String json(Object value) {
    if (value instanceof String) {
      String text = (String) value;
      return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }
    if (value instanceof Map) {
      List<String> parts = new ArrayList<>();
      for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
        parts.add(json(entry.getKey()) + ":" + json(entry.getValue()));
      }
      return "{" + String.join(",", parts) + "}";
    }
    if (value instanceof List) {
      List<String> parts = new ArrayList<>();
      for (Object item : (List<?>) value) {
        parts.add(json(item));
      }
      return "[" + String.join(",", parts) + "]";
    }
    throw new IllegalStateException("Unsupported extraction value");
  }
}
