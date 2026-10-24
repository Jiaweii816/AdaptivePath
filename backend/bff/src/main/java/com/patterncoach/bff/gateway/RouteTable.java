package com.patterncoach.bff.gateway;
import com.patterncoach.bff.audit.AiRunAudit;
public final class RouteTable {
 private RouteTable() {}
 public static boolean known(String path) {return !AiRunAudit.route(path).equals("unknown");}
 public static String key(String path){return path.substring(path.lastIndexOf('/')+1);}
 public static boolean json(String path) {return known(path);}
}
