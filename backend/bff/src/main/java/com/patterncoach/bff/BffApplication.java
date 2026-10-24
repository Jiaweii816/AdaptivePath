package com.patterncoach.bff;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import com.patterncoach.bff.config.BffProperties;
@SpringBootApplication
@EnableConfigurationProperties(BffProperties.class)
public class BffApplication {
    public static void main(String[] args) { SpringApplication.run(BffApplication.class, args); }
}
