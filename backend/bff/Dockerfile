FROM eclipse-temurin:17-jdk AS build
WORKDIR /build
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -B -ntp dependency:go-offline
COPY src src
RUN ./mvnw -B -ntp -DskipTests package
FROM eclipse-temurin:17-jre
WORKDIR /app
RUN useradd --system --uid 10001 bff
COPY --from=build --chown=bff:bff /build/target/bff-0.1.0.jar app.jar
USER bff
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
